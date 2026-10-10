(()=>{'use strict';
const $=s=>document.querySelector(s), esc=s=>String(s??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
const state={rows:[],catalog:{},index:0,active:0,optionCursor:{},dirty:false,revision:0,missingOnly:false,view:[]};
const AGE=['5세 이상','14세 이상']; const LEVEL=['초심','중급','숙련'];
const defs=[
 {key:'recommendEnabled',label:'추천 노출',type:'bool',required:true},
 {key:'popularityScore',label:'인기 우선도',type:'choice',choices:['0','1','2','3','4','5'],required:false},
 {key:'curatorPriority',label:'큐레이터 우선도',type:'choice',choices:['0','1','2','3','4','5'],required:false},
 {key:'craftCategories',label:'공예 분류 태그',type:'tags',required:true},
 {key:'crawledExtraTags',label:'크롤링 보조 태그',type:'tags',required:false},
 {key:'under4ParentSuitable',label:'4세 이하 부모 동반 추천',type:'bool',required:true},
 {key:'priceOverride',label:'체험 가격',type:'number',unit:'원',required:false},
 {key:'girlsOnly',label:'여아만 체험 가능 안내',type:'bool',required:false},
 {key:'craftDescription',label:'공예 설명',type:'textarea',required:false},
 {key:'durationMinutes',label:'체험시간',type:'number',unit:'분',required:true},
 {key:'ageBand',label:'최소 체험 연령',type:'choice',choices:AGE,required:true},
 {key:'experienceMinLevel',label:'최소 경험수준',type:'choice',choices:LEVEL,required:true},
 {key:'precisionLevel',label:'체험 난이도',type:'choice',choices:['1','2','3','4','5'],required:true},
 {key:'soloSuitable',label:'1인 체험 적합',type:'bool',required:true},
 {key:'reservationRequired',label:'사전예약 필수',type:'bool',required:true},
 {key:'sameDayAvailable',label:'당일 체험 가능',type:'bool',required:true},
 {key:'resultTags',label:'결과물 태그',type:'tags',required:true},
 {key:'processTags',label:'제작방식 태그',type:'tags',required:true},
 {key:'styleTags',label:'분위기 태그',type:'tags',required:true},
 {key:'materialTags',label:'재료 태그',type:'tags',required:false},
 {key:'notes',label:'메모',type:'text',required:false}
];

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

function srcKey(k){return k+'Source'}
function sourceOf(rec,d){if(d.key==='notes')return rec.notes?'manual':'missing';const s=rec[srcKey(d.key)]||(d.key==='precisionLevel'?rec.precisionSource:'');if(s)return s;const v=rec[d.key];return isMissingValue(v,d)?'missing':'manual'}
function sourceLabel(s){return {manual:'수동확정',draft:'검수 전 초안',crawled:'크롤링',inferred:'자동추정',default:'기본값',missing:'미입력'}[s]||s}
function isMissingValue(v,d){if(!d.required)return false;if(d.type==='tags')return !Array.isArray(v)||!v.length;if(d.type==='bool')return typeof v!=='boolean';return v===''||v==null}
function missingDefs(rec){return defs.filter(d=>d.required&&isMissingValue(rec[d.key],d))}
function current(){return state.view[state.index]||state.rows[0]}
function normalizeView(){const curTid=current()?.program?.tid;state.view=state.missingOnly?state.rows.filter(x=>missingDefs(x.recommendation).length):state.rows.slice();let idx=state.view.findIndex(x=>x.program.tid===curTid);state.index=Math.max(0,idx>=0?idx:0)}
async function api(path,opt){
 if(window.KCEM_CLOUD_API)return window.KCEM_CLOUD_API(path,opt);
 const sep=path.includes('?')?'&':'?';const expectedInstance=new URLSearchParams(location.search).get('instance')||'';const url=path+sep+'_v=79&_ts='+Date.now()+(expectedInstance?'&instance='+encodeURIComponent(expectedInstance):'');
 const r=await fetch(url,{cache:'no-store',...(opt||{})});
 const raw=await r.text();let j;
 try{j=raw?JSON.parse(raw):{};}catch(_){throw new Error(`JSON 응답 아님 (${r.status}) · ${url}`)}
 if(!r.ok||j.ok===false)throw new Error(j.error||`${r.status} ${r.statusText}`);
 return j;
}
function setDiag(t,err=false){const el=$('#diag');if(!el)return;el.textContent=t||'';el.classList.toggle('error',!!err)}
async function load(){
 try{
   setSave('서버 인스턴스 확인 중...');
   const expectedInstance=new URLSearchParams(location.search).get('instance')||'';
   const h=await api('/api/recommendation/health');
   if(h.serverVersion!=='v63')throw new Error(`8767에 구버전 서버가 응답 중입니다. 기대 v63 / 실제 ${h.serverVersion||'알 수 없음'}`);
   if(expectedInstance&&h.instanceId!==expectedInstance)throw new Error(`8767 서버 인스턴스 불일치 · 브라우저 ${expectedInstance} / 서버 ${h.instanceId||'없음'}`);
   if(Number(h.programCount)<1)throw new Error(`서버 HEALTH 프로그램 ${h.programCount??'?'}개 · Source: ${h.programSource||'없음'}`);
   setSave('추천 데이터 불러오는 중...');
   const d=await api('/api/recommendation/data');window.KCEM_EDITOR_BASE=structuredClone(d);
   if(expectedInstance&&d.instanceId!==expectedInstance)throw new Error('DATA 응답 서버 인스턴스가 바뀌었습니다.');
   if(!Array.isArray(d.records))throw new Error('서버 응답에 records 배열이 없습니다.');
   state.rows=d.records.filter(x=>x&&x.program&&x.recommendation);
   state.catalog=d.tagCatalog||{};state.materials=d.materials||{};state.revision=Number(d.revision)||0;
   const serverCount=Number(d.programCount);
   if(Number.isFinite(serverCount)&&serverCount!==state.rows.length)throw new Error(`SERVER ${serverCount} / UI ${state.rows.length} 데이터 개수가 다릅니다.`);
   if(!state.rows.length)throw new Error(`프로그램 0개 · Source: ${d.programSource||'없음'}`);
   normalizeView();render();
   setDiag(`${d.serverVersion||'server ?'} · SERVER ${serverCount||state.rows.length} · UI ${state.rows.length} · COVER ${d.coverCount??'?'}`);
   setSave(`TABLE R${state.revision} · 자동저장 준비`);
 }catch(e){
   state.rows=[];state.view=[];
   $('#counter').textContent='로드 실패';
   $('#fields').innerHTML=`<div class="load-error"><b>추천 데이터 로드 실패</b><br>${esc(e.message)}<br><small>브라우저 새로고침 후에도 같으면 CMD 창의 [API] 로그를 확인하세요.</small></div>`;
   setDiag('v63 · DATA ERROR',true);setSave('로드 실패: '+e.message,true);
 }
}
function setSave(t,err=false){$('#saveState').textContent=t;$('#saveState').style.color=err?'#ff7878':'#9bd3a7'}
function coverCandidates(p){
 const tid=p.tid,raw=p.image||'',resolved=p.coverPath||'',ver=p.coverVersion||58;
 const arr=[`assets/programs/cover/${encodeURIComponent(tid)}.webp?v=81`];
 if(resolved)arr.push(`${resolved}?m=${ver}`);
 arr.push(`assets/programs/cover/${tid}.png?v=63`,`assets/programs/cover/${tid}.jpg?v=63`);
 if(raw)arr.push(`${raw}?v=63`);
 return [...new Set(arr.filter(Boolean))];
}
function setImage(p){
 const img=$('#cover'),fb=$('#coverFallback'),arr=coverCandidates(p);let i=0;fb.style.display='none';
 const next=()=>{if(i>=arr.length){img.removeAttribute('src');fb.style.display='block';fb.textContent='NO COVER';return}img.src=arr[i++]};
 img.onerror=next;img.onload=()=>fb.style.display='none';next();
}
function programLink(raw){
 try{const url=new URL(String(raw||''));if(!['http:','https:'].includes(url.protocol))return esc(raw||'');return `<a href="${esc(url.href)}" target="_blank" rel="noopener noreferrer">${esc(raw)}</a>`;}catch(_){return esc(raw||'')}
}
function render(){const row=current();if(!row){$('#counter').textContent='표시할 카드 없음';return}const p=row.program,r=row.recommendation;$('#counter').textContent=`${state.index+1} / ${state.view.length} · 전체 ${state.rows.length} · 미입력 ${state.rows.filter(x=>missingDefs(x.recommendation).length).length}`;$('#title').textContent=p.displayTitle||p.title;$('#meta').textContent=`${p.tid} · ${priceText(p,{...r,priceCrawled:crawledPrice(p)})} · ${p.craftField||''} · 난이도 ${r.precisionLevel||p.difficultyStars||'-'} / 5`;$('#sourceInfo').innerHTML=`원본 제목: ${esc(p.title)}<br>카테고리: ${esc((p.sourceCategories||[]).join(' / '))}<br>기존 태그: ${esc((p.recommendationTags||[]).join(' · '))}<br>URL: ${programLink(p.detailUrl)}`;setImage(p);renderFields(r);state.active=Math.min(state.active,defs.length-1);const mi=defs.findIndex(d=>d.required&&isMissingValue(r[d.key],d));focusField(mi>=0?mi:state.active,false)}
function renderFields(rec){const box=$('#fields');box.innerHTML=defs.map((d,i)=>fieldHTML(d,rec,i)).join('');box.querySelectorAll('.field').forEach((el,i)=>{el.addEventListener('click',event=>{if(event.target.closest('input, textarea, select, button, a, [contenteditable]'))return;focusField(i);});});bindControls(rec);bindPriceReset(rec);bindCraftAdd(rec);bindMaterialAdd(rec)}
function fieldHTML(d,r,i){const s=d.key==='priceOverride'?(moneyNumber(r.priceOverride)!==null?'manual':crawledPrice(current().program)!==null?'crawled':'missing'):d.key==='girlsOnly'?(typeof r.girlsOnly==='boolean'?sourceOf(r,d):'default'):sourceOf(r,d),v=d.key==='priceOverride'?(moneyNumber(r.priceOverride)??crawledPrice(current().program)):d.key==='girlsOnly'?girlsOnly(current().program,r):d.key==='ageBand'&&['4세 이하','5~7세','8~13세','5~13세','전체연령'].includes(r[d.key])?'5세 이상':r[d.key];let ctl='';
 if(d.type==='number')ctl=`<input data-key="${d.key}" type="number" min="0" ${d.key==='priceOverride'?'step="1" placeholder="가격 미확인"':''} value="${esc(v??'')}"><span>${d.unit||''}</span>`;
 else if(d.type==='text')ctl=`<input data-key="${d.key}" type="text" value="${esc(v??'')}">`;
 else if(d.type==='textarea')ctl=`<textarea data-key="${d.key}" rows="4" placeholder="상세페이지/간략 메뉴에 표시할 공예 설명">${esc(v??'')}</textarea>`;
 else if(d.type==='choice')ctl=d.choices.map((x,n)=>`<button class="choice ${String(v)===String(x)?'on':''}" data-key="${d.key}" data-value="${esc(x)}"><kbd>${n+1}</kbd><span>${esc(d.key==='precisionLevel'?(['','1 · 아주 쉬움','2 · 쉬움','3 · 보통','4 · 어려움','5 · 전문'][Number(x)]):(['popularityScore','curatorPriority'].includes(d.key)?'우선도 '+x:x))}</span></button>`).join('');
 else if(d.type==='bool'){const yes=v===true;ctl=`<button class="choice ${yes?'on':''}" data-key="${d.key}" data-value="true"><kbd>1</kbd><span>예</span></button><button class="choice ${v===false?'on':''}" data-key="${d.key}" data-value="false"><kbd>2</kbd><span>아니오</span></button>`}
 else if(d.type==='tags'){const cat=[...new Set([...(state.catalog[d.key]||[]),...(Array.isArray(v)?v:[])])];state.catalog[d.key]=cat;ctl=cat.map((x,n)=>`<button class="choice ${(v||[]).includes(x)?'on':''}" data-key="${d.key}" data-value="${esc(x)}"><kbd>${n+1}</kbd><span>${esc(d.key==='precisionLevel'?(['','1 · 아주 쉬움','2 · 쉬움','3 · 보통','4 · 어려움','5 · 전문'][Number(x)]):(['popularityScore','curatorPriority'].includes(d.key)?'우선도 '+x:x))}</span></button>`).join('')}
 if(d.key==='priceOverride')ctl+='<button type="button" data-reset-price>크롤링 가격으로 복원</button>';
 if(d.key==='materialTags'){ctl+='<small class="field-help">'+esc(Object.entries(state.materials||{}).map(([name,m])=>name+' · 난이도 '+m.difficulty).join(' / '))+'</small>';}
 if(d.key==='materialTags')ctl+='<div class="craft-add"><input data-new-material maxlength="40" placeholder="신규 재료 이름"><select data-material-level><option value="">재료 난이도</option><option>1</option><option>2</option><option>3</option><option>4</option><option>5</option></select><button data-add-material>재료 추가 / 난이도 수정</button></div>';
 if(d.key==='craftCategories')ctl+='<div class="craft-add"><input data-new-craft type="text" maxlength="40" placeholder="분류 직접 추가 (예: 슈링클스)"><button type="button" data-add-craft>추가</button></div>';
 const help={priceOverride:'크롤링 원본: '+(current().program.price||(crawledPrice(current().program)===null?'가격 미확인':crawledPrice(current().program).toLocaleString('ko-KR')+'원'))+'. 수동 가격을 비우면 원본 가격으로 돌아갑니다. 0원은 무료이며 가격 미확인과 구분됩니다.',girlsOnly:'추천에서 제외하지 않고 카드에 ‘여아만 체험 가능’을 표시합니다. 공주 공예 세트는 기본적으로 예입니다.',under4ParentSuitable:'부모가 함께 만들 수 있는 4세 이하 전용 추천 체험만 예로 지정하세요. 아이와 부모 최소 2명 접수, 각각 체험비 결제가 필요합니다.',precisionLevel:'가격과 별개인 제작 난이도입니다. 1~2 기초 / 3 보통 / 4 정밀 작업 / 5 전문 과정. 추천 점수와 카드 별에 반영됩니다.',craftCategories:'공예 종류를 선택하세요. 첫 번째 태그가 대표 분류입니다. 기존 선택값은 보존됩니다.',crawledExtraTags:'교육 형태·분위기·대상 등 공예 종류가 아닌 크롤링 태그입니다. 분류 자동선택 BAT로 채울 수 있습니다.',ageBand:'5세 이상은 5~13세와 14세 이상 모두에게 추천됩니다. 14세 이상은 5~13세 추천에서 제외됩니다. 4세 이하 부모 동반 추천은 위의 별도 항목으로 지정합니다.'}[d.key]||'';
 return `<div class="field" tabindex="0" data-i="${i}" data-key="${d.key}" data-source="${s}"><label>${esc(d.label)}</label><div class="control ${d.type==='tags'?'tags':''}">${ctl}${help?`<small class="field-help">${esc(help)}</small>`:''}</div><span class="source">${sourceLabel(s)}</span></div>`}
function bindControls(rec){document.querySelectorAll('input[data-key], textarea[data-key]').forEach(inp=>{inp.addEventListener('focus',()=>focusField(+inp.closest('.field').dataset.i,false));inp.addEventListener('input',()=>{const k=inp.dataset.key;rec[k]=inp.type==='number'?(inp.value===''?'':Number(inp.value)):inp.value;markManual(k);if(k==='priceOverride'){const p=current().program;$('#meta').textContent=p.tid+' · '+priceText(p,{...rec,priceCrawled:crawledPrice(p)})+' · '+(p.craftField||'')+' · 난이도 '+(rec.precisionLevel||p.difficultyStars||'-')+' / 5';const field=inp.closest('.field');field.querySelector('.source').textContent=moneyNumber(rec.priceOverride)!==null?'수동확정':crawledPrice(p)!==null?'크롤링':'미입력';}scheduleSave()})});document.querySelectorAll('button.choice').forEach(b=>b.onclick=()=>{const k=b.dataset.key,d=defs.find(x=>x.key===k);if(d.type==='tags'){rec[k]=Array.isArray(rec[k])?rec[k]:[];const ix=rec[k].indexOf(b.dataset.value);ix>=0?rec[k].splice(ix,1):rec[k].push(b.dataset.value)}else if(d.type==='bool'){rec[k]=b.dataset.value==='true'}else rec[k]=b.dataset.value;markManual(k);renderFields(rec);focusField(defs.indexOf(d),false);scheduleSave()})}
function bindPriceReset(rec){
 const input=document.querySelector('input[data-key="priceOverride"]'),button=document.querySelector('[data-reset-price]');
 if(!input||!button)return;
 input.addEventListener('blur',()=>{if(rec.priceOverride===''||rec.priceOverride==null)input.value=crawledPrice(current().program)??'';});
 button.onclick=()=>{
  rec.priceOverride='';markManual('priceOverride');
  rec.priceOverrideSource=crawledPrice(current().program)===null?'missing':'crawled';
  renderFields(rec);focusField(defs.findIndex(d=>d.key==='priceOverride'),false);scheduleSave();
 };
}
function bindCraftAdd(rec){
 const input=document.querySelector('[data-new-craft]'),button=document.querySelector('[data-add-craft]');
 if(!input||!button)return;
 const add=()=>{const value=input.value.trim();if(!value)return;rec.craftCategories=Array.isArray(rec.craftCategories)?rec.craftCategories:[];if(!rec.craftCategories.includes(value))rec.craftCategories.push(value);state.catalog.craftCategories=[...new Set([...(state.catalog.craftCategories||[]),value])];markManual('craftCategories');renderFields(rec);scheduleSave();};
 button.onclick=add;input.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();e.stopPropagation();add();}});
}
function bindMaterialAdd(rec){
 const button=document.querySelector('[data-add-material]');if(!button)return;
 button.onclick=async()=>{try{
 const name=document.querySelector('[data-new-material]').value.trim(),difficulty=Number(document.querySelector('[data-material-level]').value);
 if(!name||!Number.isInteger(difficulty)||difficulty<1||difficulty>5)throw new Error('재료 이름과 난이도 1~5를 입력하세요');
 await api('/api/recommendation/material',{method:'POST',body:JSON.stringify({name,difficulty})});
 state.materials ||= {};state.materials[name]={difficulty};
 state.catalog.materialTags=[...new Set([...(state.catalog.materialTags||[]),name])];
 rec.materialTags=[...new Set([...(rec.materialTags||[]),name])];markManual('materialTags');renderFields(rec);scheduleSave();
 }catch(e){setSave(e.message,true)}};
}
// Keep the record object alive: input handlers close over this same object.
const editVersions=new WeakMap(),savedVersions=new WeakMap();
function version(row){return editVersions.get(row)||0}
function refreshDirty(){state.dirty=state.rows.some(row=>version(row)>(savedVersions.get(row)||0))}
function markManual(k){const row=current(),rec=row.recommendation;if(k!=='notes')rec[srcKey(k)]='manual';rec.reviewStatus='editing';editVersions.set(row,version(row)+1);refreshDirty();}
let timer=null,saveChain=Promise.resolve();
function scheduleSave(){clearTimeout(timer);timer=setTimeout(()=>save(false),700)}
function prepareRecommendation(p,r){
 if(r.priceOverride!==''&&r.priceOverride!=null&&moneyNumber(r.priceOverride)===null)throw new Error('가격은 0 이상의 정수로 입력하세요.');
 return {...r,priceCrawled:crawledPrice(p),priceCrawledText:String(p.price||''),girlsOnly:girlsOnly(p,r)};
}
window.KCEM_CRAFT_META={prepareRecommendation};
function save(show=true,targetRow=null){
 clearTimeout(timer);const row=targetRow||current();if(!row)return Promise.resolve(true);
 const tid=row.program.tid;
 saveChain=saveChain.catch(()=>false).then(async()=>{
  // Snapshot when this queued request starts, not while older requests run.
  const sentVersion=version(row);
  try{
   const snapshot=prepareRecommendation(row.program,JSON.parse(JSON.stringify(row.recommendation||{})));
   setSave('저장 중...');
   const d=await api('/api/recommendation/save',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({tid,recommendation:snapshot})});
   if(!d.saved || d.saved.tid!==tid || Object.keys(snapshot).filter(k=>k!=='updatedAt').some(k=>JSON.stringify(d.saved[k])!==JSON.stringify(snapshot[k])))throw new Error('저장 응답과 입력값이 다릅니다. 입력 내용은 유지됩니다.');
   state.revision=d.revision;
   savedVersions.set(row,Math.max(savedVersions.get(row)||0,sentVersion));
   if(version(row)===sentVersion){
    // Do NOT replace row.recommendation: existing controls reference it.
    Object.assign(row.recommendation,d.saved);
   }
   refreshDirty();
   setSave(state.dirty?'추가 수정사항 저장 대기 중...':`저장 완료 · TABLE R${state.revision}`);
   // No form redraw here: preserve typing, caret, and event-handler identity.
   return true;
  }catch(e){state.dirty=true;setSave('저장 실패: '+e.message,true);return false;}
 });
 return saveChain;
}
function paintOptionCursor(){document.querySelectorAll('.choice.kbd').forEach(e=>e.classList.remove('kbd'));const d=defs[state.active];if(!d||!['tags','choice','bool'].includes(d.type))return;const el=document.querySelector(`.field[data-i="${state.active}"]`);const bs=[...(el?.querySelectorAll('.choice')||[])];if(!bs.length)return;let ix=state.optionCursor[d.key]??0;ix=Math.max(0,Math.min(bs.length-1,ix));state.optionCursor[d.key]=ix;bs[ix].classList.add('kbd')}
function focusField(i,focus=true){state.active=Math.max(0,Math.min(defs.length-1,i));document.querySelectorAll('.field').forEach((e,n)=>e.classList.toggle('active',n===state.active));const el=document.querySelector(`.field[data-i="${state.active}"]`);if(focus){const inp=el?.querySelector('input, textarea');(inp||el)?.focus({preventScroll:true})}paintOptionCursor();el?.scrollIntoView({block:'nearest'})}
function nextMissing(){const rec=current().recommendation;for(let k=1;k<=defs.length;k++){const i=(state.active+k)%defs.length,d=defs[i];if(d.required&&isMissingValue(rec[d.key],d)){focusField(i);return true}}setSave(`현재 카드 필수값 완료 · Ctrl+Enter 다음 카드`);return false}
let navigating=false;
async function moveCard(delta){
 if(navigating)return;navigating=true;
 try{
  const row=current();
  do{if(!await save(false))return;}while(row && version(row)>(savedVersions.get(row)||0));
  if(!state.view.length)return;
  state.index=(state.index+delta+state.view.length)%state.view.length;state.active=0;render();
  const rec=current().recommendation,mi=defs.findIndex(d=>d.required&&isMissingValue(rec[d.key],d));focusField(mi>=0?mi:0);
 }finally{navigating=false;}
}
function cycleChoice(delta){const d=defs[state.active],rec=current().recommendation;if(d.type==='tags'){const cat=state.catalog[d.key]||[];if(!cat.length)return false;let ix=state.optionCursor[d.key]??0;ix=(ix+delta+cat.length)%cat.length;state.optionCursor[d.key]=ix;paintOptionCursor();return true}if(!['choice','bool'].includes(d.type))return false;const opts=d.type==='bool'?[true,false]:d.choices;let ix=opts.findIndex(x=>String(x)===String(rec[d.key]));ix=(ix+delta+opts.length)%opts.length;rec[d.key]=opts[ix];state.optionCursor[d.key]=ix;markManual(d.key);renderFields(rec);focusField(state.active,false);scheduleSave();return true}
function toggleCurrentTag(){const d=defs[state.active],rec=current().recommendation;if(d.type!=='tags')return false;const cat=state.catalog[d.key]||[];if(!cat.length)return false;const ix=Math.max(0,Math.min(cat.length-1,state.optionCursor[d.key]??0)),v=cat[ix];rec[d.key]=Array.isArray(rec[d.key])?rec[d.key]:[];const pos=rec[d.key].indexOf(v);pos>=0?rec[d.key].splice(pos,1):rec[d.key].push(v);markManual(d.key);renderFields(rec);focusField(state.active,false);scheduleSave();return true}
function quickNumber(n){const d=defs[state.active],rec=current().recommendation;if(d.type==='choice'&&d.choices[n-1]!=null){rec[d.key]=d.choices[n-1]}else if(d.type==='bool'&&n<=2){rec[d.key]=n===1}else if(d.type==='tags'){const cat=state.catalog[d.key]||[];if(cat[n-1]==null)return false;rec[d.key]=Array.isArray(rec[d.key])?rec[d.key]:[];const v=cat[n-1],ix=rec[d.key].indexOf(v);ix>=0?rec[d.key].splice(ix,1):rec[d.key].push(v)}else return false;markManual(d.key);renderFields(rec);focusField(state.active,false);scheduleSave();return true}
document.addEventListener('keydown',async e=>{if(e.target.closest('select'))return;if(e.ctrlKey&&e.key==='Enter'){e.preventDefault();await moveCard(e.shiftKey?-1:1);return}const target=e.target,typing=target.matches('input, textarea');if(e.key==='Enter'&&!e.ctrlKey){e.preventDefault();if(typing)target.blur();nextMissing();return}if(e.key==='ArrowUp'&&!typing){e.preventDefault();focusField(state.active-1);return}if(e.key==='ArrowDown'&&!typing){e.preventDefault();focusField(state.active+1);return}if((e.key==='ArrowLeft'||e.key==='ArrowRight')&&!typing){if(cycleChoice(e.key==='ArrowRight'?1:-1)){e.preventDefault();return}}if(e.key===' '&&!typing){if(toggleCurrentTag()){e.preventDefault();return}}if(!typing&&/^[1-9]$/.test(e.key)){if(quickNumber(Number(e.key)))e.preventDefault()}});
window.KCEM_EDITOR_SAVE_PENDING=async()=>{for(const row of state.rows){while(version(row)>(savedVersions.get(row)||0)){if(!await save(false,row))return false;}}return true;};
window.KCEM_EDITOR_EXPORT=()=>({...window.KCEM_EDITOR_BASE,records:structuredClone(state.rows),materials:structuredClone(state.materials||{}),tagCatalog:structuredClone(state.catalog)});
$('#prev').onclick=()=>moveCard(-1);$('#next').onclick=()=>moveCard(1);$('#save').onclick=()=>save(true);$('#filterMissing').onclick=()=>{state.missingOnly=!state.missingOnly;$('#filterMissing').classList.toggle('on',state.missingOnly);normalizeView();render()};$('#openStorage').onclick=()=>api('/api/recommendation/open-storage');window.addEventListener('beforeunload',e=>{if(state.dirty){e.preventDefault();e.returnValue=''}});load();
})();

