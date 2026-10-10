(function(){
  'use strict';
  const view = window.KCEM_PROGRAMS_VIEW;
  if(!view || !Array.isArray(view.programs) || !view.programs.length || !window.MUSEUM_DATA) return;


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

  function cleanTitle(v){
    return String(v||'').replace(/^\s*\[공예체험\]\s*/,'').replace(/\s+BEST\s*MD\s*$/i,'').replace(/\s+SOLDOUT\s*$/i,'').trim();
  }
  function stars(n){
    n=Math.max(0,Math.min(5,Number(n)||0));
    return n ? '★'.repeat(n)+'☆'.repeat(5-n) : '';
  }
  function cleanDescription(p){
    const direct=String(p.cardDescription||'').trim();
    if(direct) return direct;
    let s=String(p.description||p.shortDescription||'').trim();
    if(!s) return '';
    s=s.replace(/\bHome\b/gi,' ').replace(/상품\s*이미지/g,' ').replace(/BEST\s*MD/gi,' ');
    const terms=['공예교육',p.category,p.title,cleanTitle(p.title),p.price,...(p.sourceCategories||[])].filter(Boolean).sort((a,b)=>String(b).length-String(a).length);
    terms.forEach(t=>{ s=s.split(String(t)).join(' '); });
    s=s.replace(/가격문의\s*\(?/g,' ').replace(/(^|\s)[012](?=\s|$)/g,' ').replace(/\s+/g,' ').trim();
    return s.length>=10?s:'';
  }
  function timeText(p){
    const n=Number(p.durationMinutes)||0;
    if(n) return n>=60 && n%60===0 ? `${n/60}시간` : `${n}분`;
    return String(p.duration||'').trim();
  }
  function embeddedCover(src){
    const key=String(src||'').trim();
    return window.KCEM_COVER_ASSET_MAP?.assets?.[key] || '';
  }
  function imageCandidates(p){
    const out=[];
    const fileMode=location.protocol==='file:';
    const add=(src,rev='')=>{
      src=String(src||'').trim();
      if(!src) return;
      const embedded=embeddedCover(src);
      if(embedded && !out.includes(embedded)) out.push(embedded);
      let live=src;
      if(!fileMode && rev && !src.startsWith('data:') && !src.startsWith('blob:')) live=src+(src.includes('?')?'&':'?')+'rev='+encodeURIComponent(String(rev));
      // Under file:/// a local Image can be displayed by the browser but the
      // canvas becomes origin-tainted, so WebGL upload fails. The sync step
      // embeds those assets above. Keep raw paths only for http(s) runtime.
      if(!fileMode && !out.includes(live)) out.push(live);
      if(src.startsWith('data:') && !out.includes(src)) out.push(src);
    };

    // 1) The synced cover path is authoritative and carries a file revision.
    add(p.coverImage,p.coverRevision);
    // 2) Exact TID names are fallbacks when no synced path is available.
    const tid=String(p.tid||'').trim();
    if(tid){
      [`assets/programs/cover/${tid}.png`,`assets/programs/cover/${tid}.webp`,`assets/programs/cover/${tid}.jpg`,`assets/programs/cover/${tid}.jpeg`].forEach(x=>add(x));
    }

    // Temporary shared sample, if explicitly enabled.
    const test=window.KCEM_COVER_TEST;
    if(test?.enabled && window.KCEM_COVER_TEST_ASSET && !out.includes(window.KCEM_COVER_TEST_ASSET)) out.push(window.KCEM_COVER_TEST_ASSET);

    // 3) Fallbacks. These are also embedded by sync when they are local files.
    add(p.coverFallbackImage); add(p.image); add(p.imageSource);
    return out;
  }
  function imageOf(p){ return imageCandidates(p)[0] || ''; }
  function tagsOf(p){
    const arr=[];
    [...(Array.isArray(p.craftTags)?p.craftTags:[]),p.craftField,...(p.recommendationTags||[]),...(p.sourceCategories||[])].forEach(x=>{ if(x && !arr.includes(x)) arr.push(x); });
    return arr.slice(0,8);
  }

  const recommendationRecords=(window.KCEM_RECOMMENDATION_MASTER && window.KCEM_RECOMMENDATION_MASTER.records) || {};
  const programs=view.programs.filter(p=>p.enabled!==false).map((p,i)=>{
    const rec=recommendationRecords[p.tid] || recommendationRecords[p.id] || {};
    const customTags=Array.isArray(rec.craftCategories)?rec.craftCategories.map(x=>String(x).trim()).filter(Boolean):[];
    const difficulty=Number(rec.precisionLevel);
    const effectiveStars=Number.isInteger(difficulty)&&difficulty>=1&&difficulty<=5?difficulty:Number(p.difficultyStars)||0;
    return ({
    ...p,
    craftTags:customTags.length?customTags:p.craftTags,
    craftField:customTags[0]||p.craftField,
    recommendationData:rec,
    id:p.tid||p.id,
    sourceId:p.id,
    title:cleanTitle(p.cardTitle||p.title),
    category:customTags[0]||(Array.isArray(p.craftTags)&&p.craftTags[0])||p.craftField||p.category||'공예체험',
    educationCategory:p.category||'',
    level:stars(effectiveStars)||'',
    difficultyStars:effectiveStars,
    time:timeText(p),
    durationMinutes:Number(rec.durationMinutes||p.durationMinutes)||0,
    age:p.age||'',
    image:imageOf(p),
    imageCandidates:imageCandidates(p),
    cardImageFit:(window.KCEM_COVER_TEST?.enabled ? (window.KCEM_COVER_TEST.fit||'contain') : (p.coverImageFit||p.cardImageFit||'cover')),
    craftDescription:String(rec.craftDescription||'').trim(),
    summary:String(rec.craftDescription||'').trim() || cleanDescription(p),
    price:priceText(p,rec),
    priceValue:effectivePrice(p,rec),
    girlsOnly:girlsOnly(p,rec),
    recommend:Array.from(new Set([...(tagsOf(p)||[]),...(rec.resultTags||[]),...(rec.processTags||[]),...(rec.styleTags||[]),...(rec.materialTags||[])])),
    explainImage:p.explainImage||p.image||p.imageSource||'',
    explainImageFit:p.explainImageFit||'cover',
    detailImages:Array.isArray(p.detailImages)?p.detailImages:(Array.isArray(p.finishedImages)?p.finishedImages:[]),
    finishedImages:Array.isArray(p.detailImages)?p.detailImages:(Array.isArray(p.finishedImages)?p.finishedImages:[]),
    featured:p.featured===true || i===0,
    bestRank:p.bestRank || (i<3?i+1:null)
  });} );

  window.MUSEUM_DATA.programs=programs;

  const easy=programs.filter(p=>p.difficultyStars && p.difficultyStars<=2).slice(0,3);
  const craft=programs.filter(p=>/자개|전통|민화|목공|도자/.test(`${p.category} ${p.title}`)).slice(0,3);
  const eco=programs.filter(p=>/환경|리사이클|새활용|커피박|친환경/.test(`${p.category} ${p.title} ${(p.recommend||[]).join(' ')}`)).slice(0,3);
  const fallback=(start)=>programs.slice(start,start+3);
  window.MUSEUM_DATA.recommend={
    title:'공예 추천',
    subtitle:'원하는 분위기와 난이도에 맞춰 체험을 살펴보세요.',
    groups:[
      {title:'가볍게 시작',copy:'처음 체험하는 분도 부담 없이 선택할 수 있어요.',programIds:(easy.length?easy:fallback(0)).map(p=>p.id)},
      {title:'전통의 손맛',copy:'재료와 문양에서 한국 공예의 분위기를 느껴보세요.',programIds:(craft.length?craft:fallback(3)).map(p=>p.id)},
      {title:'새로운 재료',copy:'친환경 소재와 새로운 방식의 공예를 만나보세요.',programIds:(eco.length?eco:fallback(6)).map(p=>p.id)}
    ]
  };

  window.KCEM_RUNTIME={programs,stars,cleanTitle};
})();
