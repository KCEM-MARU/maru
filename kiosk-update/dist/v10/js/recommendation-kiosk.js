(function(){
  'use strict';

  const VERSION='v84.price-and-participation';
  const CARD_BACK='assets/programs/card_back.png';
  const state={step:-1,answers:{},results:[],busy:false,shownIds:new Set(),revealed:new Set(),setIndex:0,parentConfirm:false};
  const imageCache=new Map();
  let renderEpoch=0;
  const motionTimers=new Set();
  const impactLayers=new Set();
  function later(fn,ms){const id=window.setTimeout(()=>{motionTimers.delete(id);fn();},ms);motionTimers.add(id);return id;}
  function clearMotion(){motionTimers.forEach(id=>window.clearTimeout(id));motionTimers.clear();impactLayers.forEach(layer=>layer.remove());impactLayers.clear();}
  const reducedMotion=()=>window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const questions=[
    {key:'age',title:'몇 살인가요?',options:[['under4','4세 이하'],['child','5~13세'],['adult','14세 이상']]},
    {key:'budget',title:'1인 체험비는 어느 정도가 좋나요?',options:[['20000','2만원 이하'],['40000','4만원 이하'],['any','가격 상관없어요']]},
    {key:'experience',title:'공예체험이 익숙한가요?',options:[['초심','처음이에요'],['중급','몇 번 해봤어요'],['숙련','익숙해요']]},
    {key:'party',title:'몇 명이 함께하나요?',options:[['1','1명'],['2','2명'],['3','3명 이상']]},
    {key:'time',title:'오늘 얼마나 시간이 있나요?',options:[['30','30분 정도'],['60','1시간 정도'],['90','여유 있어요']]},
    {key:'result',title:'어떤 걸 만들고 싶나요?',options:[['작은소품','작은 소품'],['실용품','쓸 수 있는 물건'],['장식작품','장식 작품']]},
    {key:'style',title:'어떤 느낌이 좋나요?',options:[['귀여움','귀엽고 가볍게'],['전통','전통적인 느낌'],['현대적','세련되고 트렌디하게']]}
  ];

  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':'&quot;',"'":"&#39;"}[c]));

  function moneyNumber(v){
    if(v===null||v===undefined||String(v).trim()==='')return null;
    if(typeof v==='number')return Number.isSafeInteger(v)&&v>=0?v:null;
    const s=String(v).trim().replace(/,/g,'');
    const won=s.match(/^(\d+)\s*(?:원)?$/),man=s.match(/^(\d+(?:\.\d+)?)\s*만\s*(?:원)?$/);
    const n=won?Number(won[1]):man?Number(man[1])*10000:NaN;
    return Number.isSafeInteger(n)&&n>=0?n:null;
  }
  function crawledPrice(p){
    if(/문의|협의|별도|부터|~|부터/.test(String(p.price||'')))return null;
    return moneyNumber(p.priceValue)??moneyNumber(p.price);
  }
  function effectivePrice(p,r={}){
    const override=moneyNumber(r.priceOverride);
    if(override!==null)return override;
    if(Object.prototype.hasOwnProperty.call(r,'priceCrawled'))return moneyNumber(r.priceCrawled);
    return crawledPrice(p);
  }
  function priceText(p,r={}){const n=effectivePrice(p,r);return n===null?'가격 문의':n.toLocaleString('ko-KR')+'원';}
  function girlsOnly(p,r={}){
    if(typeof r.girlsOnly==='boolean')return r.girlsOnly;
    return ['kcem-53-00114','kcem-53-114'].includes(String(p.tid||p.id));
  }

  function budgetTier(p){
    const cap=Number(state.answers.budget);if(!Number.isFinite(cap)||cap<=0)return 0;
    const price=effectivePrice(p,recOf(p));return price===null?1:price<=cap?0:2;
  }
  function recOf(p){return p?.recommendationData||{};}
  function allTags(p){const r=recOf(p);return new Set([...(p.recommend||[]),...(r.resultTags||[]),...(r.processTags||[]),...(r.styleTags||[]),...(r.materialTags||[])]);}
  function isSameDay(p){const r=recOf(p);return typeof r.sameDayAvailable==='boolean' ? r.sameDayAvailable : r.reservationRequired!==true;}
  function isRecommendationEnabled(p){return recOf(p).recommendEnabled!==false;}

  function ageEligible(p){
    // Under-four recommendations remain a separate operator-approved pool.
    if(state.answers.age==='under4')return state.answers.parentConsent===true && recOf(p).under4ParentSuitable===true;
    // Legacy child bands describe the lower threshold, not an upper age limit.
    const ageText=String(recOf(p).ageBand||p.age||'').trim();
    const adultMinimum=/14\s*세\s*이상|성인/.test(ageText);
    return state.answers.age!=='child' || !adultMinimum;
  }
  function difficultyScore(p){
    const n=Number(recOf(p).precisionLevel);
    if(!Number.isInteger(n)||n<1||n>5)return 0;
    const level=state.answers.experience||'초심';
    if(level==='초심')return n<=2?6:-(n-2)*4;
    if(level==='중급')return n===2||n===3?6:n===1?2:-(n-3)*4;
    return n>=4?6:2;
  }

  function matchScore(p){
    const r=recOf(p), a=state.answers; let s=Number(r.recommendWeight)||0;
    const tags=allTags(p);
    const duration=Number(r.durationMinutes||p.durationMinutes)||60;
    const available=Number(a.time)||60;
    if(duration<=available) s+=8; else if(duration<=available+30) s+=2; else s-=7;
    const needLevel={초심:0,중급:1,숙련:2}[r.experienceMinLevel] ?? 0;
    const userLevel={초심:0,중급:1,숙련:2}[a.experience] ?? 0;
    if(userLevel>=needLevel) s+=5; else s-=8;
    if(a.party==='1') s += r.soloSuitable===false ? -12 : 5;
    if(a.result && tags.has(a.result)) s+=10;
    if(a.style && tags.has(a.style)) s+=10;
    if(r.sameDayAvailable===true) s+=5;
    if(r.reservationRequired===true) s-=2;
    s+=difficultyScore(p);
    // Material is a bounded adjustment, never a replacement for activity difficulty.
    const catalog=window.KCEM_RECOMMENDATION_MASTER?.materials||{};
    const levels=(r.materialTags||[]).map(t=>Number(catalog[t]?.difficulty)).filter(n=>Number.isInteger(n)&&n>=1&&n<=5);
    if(levels.length){const average=levels.reduce((x,y)=>x+y,0)/levels.length;
      const target={초심:1,중급:3,숙련:5}[a.experience]||1;
      s+=Math.max(-3,Math.min(3,3-Math.abs(average-target)*1.5));
    }
    // 자연/친환경은 별도 질문으로 강요하지 않는다. 재료/공예 메타데이터로만 유지하고
    // 현재 응답에서 근거가 없을 때는 취향 점수로 추측하지 않는다.
    // Equal scores retain the source order; title length is not a preference.
    return s;
  }

  function ranked(excluded){
    const skip=excluded||new Set();
    return (window.MUSEUM_DATA?.programs||[])
      .filter(p=>isRecommendationEnabled(p) && ageEligible(p) && !skip.has(String(p.id)))
      .map(p=>({p,score:matchScore(p)}))
      .sort((a,b)=>budgetTier(a.p)-budgetTier(b.p)||b.score-a.score);
  }

  function bestBy(list, metric){
    if(!list.length)return null;
    return list.slice().sort((a,b)=>budgetTier(a.p)-budgetTier(b.p)||metric(b)-metric(a))[0]||null;
  }

  function fillSameDay(chosen,pool){
    let count=chosen.filter(x=>isSameDay(x.p)).length;
    if(count>=2)return chosen;
    const backups=pool.filter(x=>isSameDay(x.p)&&!chosen.some(y=>y.p.id===x.p.id));
    while(count<2 && backups.length){
      const incoming=backups.shift();
      let ix=-1;
      for(let i=chosen.length-1;i>=0;i--){
        if(!isSameDay(chosen[i].p) && chosen[i].role!=='curator'){ix=i;break;}
      }
      if(ix<0){for(let i=chosen.length-1;i>=0;i--){if(!isSameDay(chosen[i].p)){ix=i;break;}}}
      if(ix<0)break;
      chosen[ix]={...incoming,role:'match'}; count++;
    }
    return chosen;
  }

  function pickResults(useNext=false){
    // setIndex is the number of sets already drawn: initial + reloads 1/2
    // are same-day only. Reload 3 (the fourth set) may include unavailable crafts.
    if(!useNext){state.setIndex=0;state.shownIds.clear();}
    const allowUnavailable=state.answers.age!=='under4' && useNext && state.setIndex>=3;
    const eligible=excluded=>ranked(excluded).filter(x=>allowUnavailable || isSameDay(x.p));
    let pool=eligible(state.shownIds);
    // Show remaining unseen items even if fewer than three. Recycle only on
    // exhaustion, and always keep the same-day gate when recycling.
    if(!pool.length){state.shownIds.clear();pool=eligible(state.shownIds);}
    const chosen=[];
    const take=(item,role)=>{if(!item||chosen.some(x=>x.p.id===item.p.id))return;chosen.push({...item,role});};

    // 1) 사용자 응답과 가장 잘 맞는 체험.
    take(pool[0],'match');
    let remaining=pool.filter(x=>!chosen.some(y=>y.p.id===x.p.id));

    // 2) 방문객 선호도가 입력된 경우 인기 체험을 한 장. 값이 없으면 두 번째 맞춤 카드.
    const hasPopularity=remaining.some(x=>Number(recOf(x.p).popularityScore)>0);
    const popular=hasPopularity ? bestBy(remaining,x=>Number(recOf(x.p).popularityScore)*14 + x.score*.65) : remaining[0];
    take(popular,hasPopularity?'popular':'match');
    remaining=pool.filter(x=>!chosen.some(y=>y.p.id===x.p.id));

    // 3) 큐레이터/재고 우선도가 입력된 경우 한 장. 값이 없으면 다음 맞춤 카드.
    const hasCurator=remaining.some(x=>Number(recOf(x.p).curatorPriority)>0);
    const curator=hasCurator ? bestBy(remaining,x=>Number(recOf(x.p).curatorPriority)*16 + x.score*.45) : remaining[0];
    take(curator,hasCurator?'curator':'match');

    for(const x of pool){if(chosen.length>=3)break;take(x,'match');}
    fillSameDay(chosen,pool);
    state.results=chosen.slice(0,3);
    state.results.forEach(x=>state.shownIds.add(String(x.p.id)));
    state.revealed.clear();
    state.setIndex++;
  }

  function startView(){
    return `<div class="rk-shell rk-start" aria-live="polite">
      <div class="rk-start-copy">
        <h1 class="rk-type-title" data-rk-type>오늘의 공예를 골라드릴게요.</h1>
        <p class="rk-type-sub">몇 가지 질문에 답하면, 나에게 잘 맞는 공예체험을 추천해드려요.</p>
        <button class="rk-primary rk-rise" data-rk-start>시작하기</button>
      </div>
    </div>`;
  }

  function dots(){
    return `<div class="rk-dots" aria-hidden="true">${questions.map((_,i)=>`<i class="${i===state.step?'on':i<state.step?'done':''}"></i>`).join('')}</div>`;
  }

  function questionView(q){
    return `<div class="rk-shell rk-question" aria-live="polite">
      ${dots()}
      <div class="rk-question-center">
        <h2 class="rk-type-question" data-rk-type>${esc(q.title)}</h2>
        ${q.key==='budget'?'<p class="rk-budget-guide">1인 기준으로 선택해주세요.'+(state.answers.age==='under4'?' 아이와 부모님 각각 체험비가 적용돼요.':'')+'</p>':''}
        <div class="rk-options">${q.options.map(([v,l],i)=>`<button style="--rk-delay:${i*75}ms" data-rk-value="${esc(v)}" class="rk-choice ${state.answers[q.key]===v?'selected':''}"><span>${esc(l)}</span></button>`).join('')}</div>
      </div>
      <button class="rk-back" data-rk-back ${state.step===0?'disabled':''} aria-label="이전 질문">← 이전</button>
    </div>`;
  }

  function parentConfirmView(){
    return `<div class="rk-shell rk-question rk-parent-confirm" aria-live="polite">
      <div class="rk-question-center">
        <h2 class="rk-type-question" data-rk-type>4세 이하 아이는 부모와 함께 체험해요.</h2>
        <p class="rk-parent-guide">함께 참여하는 부모님도 체험비가 적용돼요.</p>
        <p class="rk-parent-guide rk-parent-prompt">추천 체험을 볼까요?</p>
        <div class="rk-options"><button class="rk-choice" data-rk-parent-yes><span>네, 함께 체험할게요</span></button><button class="rk-choice" data-rk-parent-no><span>연령을 다시 선택할게요</span></button></div>
      </div>
    </div>`;
  }
  function acceptParent(){
    afterExit(()=>{
      state.answers={age:'under4',parentConsent:true,party:'2',experience:'초심'};
      state.parentConfirm=false;state.step=questions.findIndex(q=>q.key==='budget');
    });
  }
  function advanceQuestion(){
    if(state.step===0 && state.answers.age==='under4'){state.parentConfirm=true;return;}
    if(state.answers.age==='under4' && questions[state.step]?.key==='budget'){pickResults(false);state.step=questions.length;return;}
    if(state.step<questions.length-1)state.step++;
    else{pickResults(false);state.step=questions.length;}
  }

  function resultCard(x,i){
    const p=x.p,unavailable=!isSameDay(p),revealed=state.revealed.has(String(p.id));
    const labels=[{text:priceText(p,recOf(p)),kind:'price'},...(girlsOnly(p,recOf(p))?[{text:'여아만 체험 가능',kind:'girls'}]:[]),...(budgetTier(p)===2?[{text:'선택 예산 초과',kind:'budget'}]:[]),...(unavailable?[{text:'오늘은 체험할 수 없어요',kind:'unavailable'}]:[])];
    return `<article class="rk-result-card js-program ${revealed?'is-revealed is-idle':''} ${unavailable?'is-unavailable':''}" role="button" tabindex="0" data-id="${esc(p.id)}" data-rk-card-id="${esc(p.id)}" style="--rk-result-delay:${i*95}ms;--rk-float-delay:${-i*1.15}s;--rk-glint-delay:${[2,0,1][i]*720}ms" aria-label="${esc(p.title)} 카드 — ${esc(labels.map(l=>l.text).join(' · '))}">
      <div class="rk-result-float"><div class="rk-card-impact">
        <div class="rk-flip">
          <div class="rk-card-face rk-card-back" aria-hidden="${revealed?'true':'false'}"><img src="${CARD_BACK}" alt=""></div>
          <div class="rk-card-face rk-card-front" aria-hidden="${revealed?'false':'true'}">
            <div class="rk-result-card-visual" data-rk-card-visual><div class="rk-card-placeholder"></div></div>
            <div class="rk-card-notices">${labels.map(l=>`<span class="rk-card-notice rk-notice-${l.kind}">${esc(l.text)}</span>`).join('')}</div>
          </div>
        </div>
      </div></div>
    </article>`;
  }

  function resultsView(){
    return `<div class="rk-shell rk-results is-loading" aria-live="polite" aria-busy="true">
      <div class="rk-result-loading" role="status">카드를 준비하고 있어요…</div>
      <div class="rk-result-head"><h2 class="rk-type-result" data-rk-type>${!state.results.length?(state.answers.age==='under4'?'오늘 가능한 부모 동반 체험이 없어요':'오늘 추천할 수 있는 체험이 없어요'):state.revealed.size?'마음에 드는 체험을 골라주세요':'카드를 클릭하세요'}</h2></div>
      ${state.answers.age==='under4'?'<p class="rk-parent-result-note">부모와 함께 체험 · 부모님도 체험비가 적용돼요</p>':''}
      ${Number(state.answers.budget)>0 && state.results.some(x=>budgetTier(x.p)>0)?'<p class="rk-budget-result-note">예산 안의 체험이 부족해 가격 확인 또는 예산 초과 체험을 함께 표시했어요.</p>':''}
      <div class="rk-result-grid">${state.results.map(resultCard).join('')}</div>
      <div class="rk-result-actions" aria-label="추천 카드 도구">
        <button class="rk-action" data-rk-nextset aria-label="다른 추천 보기">
          <span class="rk-action-icon rk-icon-refresh" aria-hidden="true">↻</span>
          <span class="rk-action-label">다른 추천</span>
        </button>
        <button class="rk-action" data-rk-revealall ${!state.results.length?'disabled':''} aria-label="카드 모두 펼치기">
          <span class="rk-action-icon rk-icon-flipall" aria-hidden="true"><i></i><i></i><i></i></span>
          <span class="rk-action-label">모두 펼치기</span>
        </button>
        <button class="rk-action" data-rk-restart aria-label="질문 다시 하기">
          <span class="rk-action-icon rk-icon-question" aria-hidden="true">?</span>
          <span class="rk-action-label">다시 질문</span>
        </button>
      </div>
    </div>`;
  }

  function root(){return document.getElementById('recommendationKiosk');}

  function prepareTypeChars(el){
    // Build once, before the intro; never replace text at the idle boundary.
    const text=el.textContent;
    el.dataset.rkPlainText=text;el.setAttribute('aria-label',text);
    const fragment=document.createDocumentFragment();
    const spans=Array.from(text).map(char=>{
      const span=document.createElement('span');span.className='rk-type-char';
      span.textContent=char;span.setAttribute('aria-hidden','true');
      span.style.transform='translateX(0)';fragment.appendChild(span);return span;
    });
    el.replaceChildren(fragment);return spans;
  }

  function startIdleType(el,spans){
    if(!el || reducedMotion() || !spans?.length)return;
    const n=Math.max(1,spans.length-1);
    spans.forEach((span,i)=>{
      const spread=(i-n/2)*.035;
      // Intro ends at zero; idle begins AND ends at zero. Hold briefly, open
      // right-to-left, settle left-to-right. Loop boundaries are identical.
      const open=.08+((n-i)/n)*.14, close=.58+(i/n)*.14;
      try{
        const idle=span.animate([
          {offset:0,transform:'translateX(0)'},
          {offset:open,transform:'translateX(0)'},
          {offset:open+.14,transform:`translateX(${spread}em)`},
          {offset:close,transform:`translateX(${spread}em)`},
          {offset:close+.14,transform:'translateX(0)'},
          {offset:1,transform:'translateX(0)'}
        ],{duration:12000,easing:'ease-in-out',iterations:Infinity});
        idle.id='rk-type-idle';
      }catch(_){}
    });
  }

  function typeMotion(el){
    if(!el)return;
    stopTypeAnimations(el);
    // One font size, weight and layout spacing for both phases.
    el.style.letterSpacing='-.028em';
    el.style.fontWeight='350';el.style.fontVariationSettings='"wght" 350';
    if(reducedMotion() || typeof el.animate!=='function')return;
    const spans=prepareTypeChars(el),n=Math.max(1,spans.length-1);
    try{
      const options={duration:920,easing:'cubic-bezier(.16,1,.3,1)'};
      const intros=spans.map((span,i)=>span.animate([
        {transform:`translateX(${(i-n/2)*.18}em)`},
        {transform:'translateX(0)'}
      ],options));
      const intro=el.animate([
        {opacity:0,transform:'translateY(10px)'},
        {opacity:1,transform:'translateY(0)'}
      ],options);
      Promise.all([intro.finished,...intros.map(a=>a.finished)]).then(()=>{
        if(document.contains(el) && spans.every(span=>span.parentNode===el))startIdleType(el,spans);
      }).catch(()=>{});
    }catch(_){}
  }

  function stopTypeAnimations(el){
    try{
      el?.getAnimations?.({subtree:true}).forEach(a=>a.cancel());
      if(el?.dataset.rkPlainText!==undefined){el.textContent=el.dataset.rkPlainText;delete el.dataset.rkPlainText;el.removeAttribute('aria-label');}
    }catch(_){ }
  }

  function afterExit(fn){
    const el=root();
    if(!el || state.busy)return;
    state.busy=true;
    el.classList.add('rk-page-leaving');
    window.setTimeout(()=>{fn();state.busy=false;render();},240);
  }

  function choose(button){
    if(state.busy)return;
    const q=questions[state.step];if(!q)return;
    state.answers[q.key]=button.dataset.rkValue;
    root()?.querySelectorAll('[data-rk-value]').forEach(b=>{b.disabled=true;b.classList.toggle('picked',b===button);});
    root()?.classList.add('rk-answer-picked');
    const title=root()?.querySelector('[data-rk-type]');
    stopTypeAnimations(title);
    try{title?.animate?.([
      {letterSpacing:getComputedStyle(title).letterSpacing||'-.028em',fontWeight:350,fontVariationSettings:'"wght" 350',opacity:1,transform:'none'},
      {letterSpacing:'.25em',fontWeight:350,fontVariationSettings:'"wght" 350',opacity:.1,transform:'scale(.975) translateY(-5px)'}
    ],{duration:350,easing:'ease-in',fill:'forwards'});}catch(_){ }
    window.setTimeout(()=>afterExit(advanceQuestion),220);
  }

  function loadImage(src){
    if(!src)return Promise.resolve(null);
    if(imageCache.has(src))return imageCache.get(src);
    const promise=new Promise(resolve=>{
      const img=new Image();img.decoding='async';
      let settled=false;
      const finish=value=>{if(settled)return;settled=true;window.clearTimeout(timeout);img.onload=img.onerror=null;resolve(value);};
      const timeout=window.setTimeout(()=>finish(null),12000);
      img.onload=async()=>{try{await img.decode?.();}catch(_){}finish(img);};
      img.onerror=()=>finish(null);img.src=src;
    });
    imageCache.set(src,promise);
    promise.then(img=>{if(!img && imageCache.get(src)===promise)imageCache.delete(src);});
    return promise;
  }

  async function buildVisualFor(el,p){
    const api=window.MARU_CARD_VISUAL;if(!api||!el||!p)return;
    // Prefer the assigned cover before crawler candidates.
    const candidates=[...new Set([p.coverImage,...(Array.isArray(p.imageCandidates)?p.imageCandidates:[]),p.image,p.imageSource].filter(src=>typeof src==='string' && src.trim()))];
    let cover=null;
    for(const src of candidates){cover=await loadImage(src);if(cover)break;}
    let frame=null;
    try{
      const st=api.settings?.()||window.MARU_CARD_STYLE_SETTINGS||{};
      const stars=api.difficultyStars?.(p)||Number(p.difficultyStars)||1;
      const frameSrc=st?.frame?.useImage?(api.framePath?.(stars||1,st)||st?.frame?.images?.[String(stars||1)]||''):'';
      if(frameSrc)frame=await loadImage(frameSrc);
      const canvas=api.render(p,cover,frame);
      canvas.className='rk-rendered-card';canvas.setAttribute('aria-hidden','true');el.replaceChildren(canvas);
    }catch(_){ }
  }

  async function hydrateResultCards(el,epoch){
    const scene=el.querySelector('.rk-results');if(!scene)return;
    const current=()=>epoch===renderEpoch && root()===el && el.contains(scene);
    const back=await loadImage(CARD_BACK);
    if(!current())return;
    if(!back)scene.classList.add('rk-back-fallback');
    const map=new Map((window.MUSEUM_DATA?.programs||[]).map(p=>[String(p.id),p]));
    const cards=[...scene.querySelectorAll('[data-rk-card-id]')];
    await Promise.all(cards.map(card=>buildVisualFor(card.querySelector('[data-rk-card-visual]'),map.get(String(card.dataset.rkCardId)))));
    if(!current())return;
    scene.classList.remove('is-loading');scene.classList.add('is-dealing');
    // Keep the prompt hidden until the last card has finished its entrance.
    later(()=>{
      if(!current())return;
      scene.classList.add('is-ready');scene.setAttribute('aria-busy','false');
      typeMotion(scene.querySelector('[data-rk-type]'));
    },reducedMotion()?32:860+Math.max(0,cards.length-1)*95);
  }

  function openProgramCard(el){const id=el?.dataset?.id;if(id)window.MARU_APP?.showProgramModal?.(id);}

  function resultReady(card){return !state.busy && card?.closest('.rk-results')?.classList.contains('is-ready');}

  function playImpact(card){
    const rect=card.getBoundingClientRect();
    if(!rect.width || !rect.height || !document.body)return;
    const reduced=reducedMotion(), duration=reduced?480:1000;
    if(!reduced)card.classList.add('is-impact');
    // Portal outside the 3D card tree: no card flip, clipping, or shadow filter.
    // Inline geometry and WAAPI also avoid dependence on cached effect CSS.
    const layer=document.createElement('div');layer.className='rk-impact-overlay-v68';
    layer.setAttribute('aria-hidden','true');
    Object.assign(layer.style,{position:'fixed',left:'0',top:'0',width:'100%',height:'100%',
      zIndex:'2147483647',pointerEvents:'none',overflow:'visible',background:'transparent',
      mixBlendMode:window.CSS?.supports?.('mix-blend-mode','plus-lighter')?'plus-lighter':'screen'});
    document.body.appendChild(layer);impactLayers.add(layer);
    const x=rect.left+rect.width/2,y=rect.top+rect.height/2;
    const radius=Math.max(115,Math.min(210,rect.width*.72))*1.5;
    const animations=[];
    const animate=(el,frames,options)=>{
      if(typeof el.animate==='function'){
        try{animations.push(el.animate(frames,options));}catch(_){}
      }
    };
    const make=(size)=>{
      const el=document.createElement('span');
      Object.assign(el.style,{position:'absolute',display:'block',left:`${x}px`,top:`${y}px`,
        width:`${size}px`,height:`${size}px`,margin:'0',padding:'0',boxSizing:'border-box',
        borderRadius:'50%',pointerEvents:'none',transform:'translate(-50%,-50%)'});
      layer.appendChild(el);return el;
    };
    const ring=make(radius*2);
    Object.assign(ring.style,{border:'4.5px solid #fff',boxShadow:'0 0 22.5px rgba(255,255,255,.8)'});
    animate(ring,reduced?[
      {opacity:.8},{opacity:0}
    ]:[
      {opacity:1,transform:'translate(-50%,-50%) scale(.12)'},
      {offset:.3,opacity:.95,transform:'translate(-50%,-50%) scale(.65)'},
      {opacity:0,transform:'translate(-50%,-50%) scale(1.12)'}
    ],{duration,easing:'cubic-bezier(.16,1,.3,1)',fill:'forwards'});
    const count=reduced?6:16;
    for(let i=0;i<count;i++){
      const angle=i*Math.PI*2/count, distance=radius*(.78+(i%3)*.17);
      const dx=Math.cos(angle)*distance,dy=Math.sin(angle)*distance;
      const dot=make((i%3===0?9:6)*1.5);
      Object.assign(dot.style,{background:'#fff',border:'1.5px solid #fff',boxShadow:'0 0 9px rgba(255,255,255,.9)'});
      if(reduced)dot.style.transform=`translate(calc(-50% + ${dx*.35}px),calc(-50% + ${dy*.35}px))`;
      animate(dot,reduced?[{opacity:.8},{opacity:0}]:[
        {opacity:1,transform:'translate(-50%,-50%) scale(.65)'},
        {offset:.16,opacity:1},
        {opacity:0,transform:`translate(calc(-50% + ${dx}px),calc(-50% + ${dy}px)) scale(.3)`}
      ],{duration,easing:'cubic-bezier(.12,.65,.25,1)',fill:'forwards'});
    }
    const dispose=()=>{animations.forEach(a=>a.cancel());layer.remove();impactLayers.delete(layer);};
    later(()=>card.classList.remove('is-impact'),360);
    later(dispose,duration+90);
  }

  function flipCard(card){
    const id=String(card?.dataset.rkCardId||'');
    if(!id || state.revealed.has(id))return;
    const first=state.revealed.size===0;
    state.revealed.add(id);card.classList.add('is-revealed','is-flipping');
    playImpact(card);
    card.querySelector('.rk-card-back')?.setAttribute('aria-hidden','true');
    card.querySelector('.rk-card-front')?.setAttribute('aria-hidden','false');
    later(()=>{
      card.classList.remove('is-flipping');card.classList.add('is-idle');
      if(first){const title=root()?.querySelector('[data-rk-type]');if(title){stopTypeAnimations(title);title.textContent='마음에 드는 체험을 골라주세요';typeMotion(title);}}
    },reducedMotion()?210:780);
    const all=[...root()?.querySelectorAll('[data-rk-card-id]')||[]];
    if(all.length && all.every(c=>state.revealed.has(String(c.dataset.rkCardId)))){
      const btn=root()?.querySelector('[data-rk-revealall]');
      if(btn){btn.disabled=true;btn.setAttribute('aria-label','모든 카드가 펼쳐졌습니다');}
    }
  }

  function revealOrOpen(card){
    if(!resultReady(card) || card.closest('.rk-results').classList.contains('is-revealing-all'))return;
    const id=String(card?.dataset?.rkCardId||'');if(!id)return;
    if(!state.revealed.has(id)){flipCard(card);return;}
    if(!card.classList.contains('is-flipping') && !card.classList.contains('is-opening')){
      card.classList.add('is-opening');playImpact(card);
      later(()=>{card.classList.remove('is-opening');openProgramCard(card);},reducedMotion()?0:140);
    }
  }

  function revealAll(){
    const cards=[...root()?.querySelectorAll('[data-rk-card-id]')||[]];
    if(!cards.length || !resultReady(cards[0]))return;
    const scene=cards[0].closest('.rk-results');
    if(scene.classList.contains('is-revealing-all'))return;
    scene.classList.add('is-revealing-all');
    const btn=scene.querySelector('[data-rk-revealall]');if(btn)btn.disabled=true;
    const ordered=[1,2,0].map(i=>cards[i]).filter(card=>card&&!state.revealed.has(String(card.dataset.rkCardId)));
    ordered.forEach((card,i)=>later(()=>flipCard(card),i*220));
    later(()=>scene.classList.remove('is-revealing-all'),Math.max(0,ordered.length-1)*220+800);
  }

  function nextSet(){
    if(state.busy)return;
    afterExit(()=>pickResults(true));
  }

  function bind(el){
    el.querySelector('[data-rk-parent-yes]')?.addEventListener('click',acceptParent);
    el.querySelector('[data-rk-parent-no]')?.addEventListener('click',()=>afterExit(()=>{state.parentConfirm=false;state.answers={};state.step=0;}));
    el.querySelector('[data-rk-start]')?.addEventListener('click',()=>afterExit(()=>{state.step=0;}));
    el.querySelectorAll('[data-rk-value]').forEach(b=>b.addEventListener('click',()=>choose(b)));
    el.querySelector('[data-rk-back]')?.addEventListener('click',()=>{if(state.step>0)afterExit(()=>{if(state.answers.age==='under4'&&questions[state.step]?.key==='budget'){state.parentConfirm=true;}else state.step--;});});
    el.querySelector('[data-rk-restart]')?.addEventListener('click',()=>afterExit(()=>{state.step=-1;state.parentConfirm=false;state.answers={};state.results=[];state.shownIds.clear();state.revealed.clear();state.setIndex=0;}));
    el.querySelector('[data-rk-nextset]')?.addEventListener('click',nextSet);
    el.querySelector('[data-rk-revealall]')?.addEventListener('click',revealAll);
    el.querySelectorAll('.rk-result-card.js-program').forEach(card=>{
      card.addEventListener('click',()=>revealOrOpen(card));
      card.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();revealOrOpen(card);}});
    });
  }

  function render(){
    const el=root();if(!el)return;
    clearMotion();const epoch=++renderEpoch;
    el.querySelectorAll('[data-rk-type]').forEach(stopTypeAnimations);
    el.classList.remove('rk-page-leaving','rk-answer-picked');
    if(state.parentConfirm)el.innerHTML=parentConfirmView();
    else if(state.step<0)el.innerHTML=startView();
    else if(state.step<questions.length)el.innerHTML=questionView(questions[state.step]);
    else el.innerHTML=resultsView();
    bind(el);
    window.requestAnimationFrame(()=>{
      if(epoch!==renderEpoch)return;
      if(state.step>=questions.length)hydrateResultCards(el,epoch);
      else typeMotion(el.querySelector('[data-rk-type]'));
    });
  }

  function mount(){loadImage(CARD_BACK);state.step=-1;state.parentConfirm=false;state.answers={};state.results=[];state.busy=false;state.shownIds.clear();state.revealed.clear();state.setIndex=0;render();}
  loadImage(CARD_BACK);
  window.MARU_RECOMMEND_KIOSK={mount,render,state,version:VERSION};
})();
