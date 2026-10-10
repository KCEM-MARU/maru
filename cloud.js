'use strict';
(()=>{
 const config=window.KCEM_CLOUD_CONFIG||{},$=id=>document.getElementById(id);
 let token='',refreshToken='',expiresAt=0,userId='',refreshPromise=null,refreshTimer=null,snapshot=null,revision=0,queue=Promise.resolve();
 function needLogin(){
  $('login').hidden=false;
  $('loginStatus').textContent='로그인이 만료됐습니다. 같은 계정으로 다시 로그인하면 현재 입력을 유지하며 저장합니다.';
 }
 function setSession(auth){
  token=auth.access_token;refreshToken=auth.refresh_token||'';
  expiresAt=Number(auth.expires_at)*1000||Date.now()+Number(auth.expires_in||3600)*1000;
  userId=auth.user?.id||userId;
  window.KCEM_EDITOR_ACCOUNT=config.supabaseUrl+'|'+userId;
  clearTimeout(refreshTimer);
  if(refreshToken)refreshTimer=setTimeout(()=>refresh().catch(()=>{}),Math.max(1000,expiresAt-Date.now()-60000));
 }
 async function rawRequest(path,body){
  if(!config.supabaseUrl||!config.publishableKey)throw new Error('config.js에 기존 Supabase URL과 공개 키를 입력하세요.');
  const headers={apikey:config.publishableKey,'Content-Type':'application/json'};
  if(token&&!path.startsWith('/auth/'))headers.Authorization='Bearer '+token;
  const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),15000);
  try{
   const r=await fetch(config.supabaseUrl.replace(/\/$/,'')+path,{method:body===undefined?'GET':'POST',headers,signal:controller.signal,body:body===undefined?undefined:JSON.stringify(body)});
   const data=await r.json();
   if(!r.ok){const error=new Error(data.message||data.msg||data.error_description||'DB 요청 실패');error.status=r.status;throw error;}
   return data;
  }finally{clearTimeout(timeout);}
 }
 function refresh(){
  if(refreshPromise)return refreshPromise;
  refreshPromise=(async()=>{
   if(!refreshToken){needLogin();throw new Error('다시 로그인해주세요. 현재 입력은 유지됩니다.');}
   try{
    const auth=await rawRequest('/auth/v1/token?grant_type=refresh_token',{refresh_token:refreshToken});
    setSession(auth);return auth;
   }catch(e){
    if(e.status===400||e.status===401){refreshToken='';clearTimeout(refreshTimer);needLogin();}
    throw e;
   }
  })().finally(()=>{refreshPromise=null;});
  return refreshPromise;
 }
 async function request(path,body){
  const database=path.startsWith('/rest/');
  if(database&&token&&expiresAt-Date.now()<60000)await refresh();
  try{return await rawRequest(path,body);}
  catch(e){
   if(database&&e.status===401){
    await refresh();
    try{return await rawRequest(path,body);}catch(retryError){if(retryError.status===401)needLogin();throw retryError;}
   }
   throw e;
  }
 }
 window.addEventListener('focus',()=>{if(token&&expiresAt-Date.now()<60000)refresh().catch(()=>{});});
 function enqueue(action){const job=queue.catch(()=>{}).then(action);queue=job;return job;}
 async function load(){const rows=await request('/rest/v1/kcem_craft_draft?id=eq.1&select=revision,payload');revision=rows[0]?.revision||0;snapshot=rows[0]?.payload||null;}
 async function commit(next){const result=await request('/rest/v1/rpc/kcem_craft_commit',{expected_revision:revision,new_payload:next});revision=result;snapshot=next;return result;}
 function download(value){const url=URL.createObjectURL(new Blob([JSON.stringify(value,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='craft-export.json';a.click();URL.revokeObjectURL(url);}
 window.KCEM_CLOUD_API=async(path,opt)=>{
  if(path.endsWith('/open-storage')){download(window.KCEM_EDITOR_EXPORT?window.KCEM_EDITOR_EXPORT():snapshot);return {ok:true};}
  if(!snapshot?.records?.length)throw new Error('최초 이관 파일을 선택한 뒤 화면을 새로고침하세요.');
  if(path.endsWith('/health'))return {ok:true,serverVersion:'v63',programCount:snapshot.records.length};
  if(path.endsWith('/data'))return {...snapshot,ok:true,serverVersion:'v63',revision,programCount:snapshot.records.length};
  const body=JSON.parse(opt?.body||'{}');
  if(path.endsWith('/save'))return enqueue(async()=>{
   const next=structuredClone(snapshot),row=next.records.find(x=>x.program.tid===body.tid);if(!row)throw new Error('TID 없음');
   const rec=window.KCEM_CRAFT_META?window.KCEM_CRAFT_META.prepareRecommendation(row.program,body.recommendation):body.recommendation;
   Object.assign(row.recommendation,rec,{tid:body.tid,updatedAt:new Date().toISOString()});
   if(next.master){next.master.records ||= {};next.master.records[body.tid]={...next.master.records[body.tid],...structuredClone(row.recommendation)};}
   await commit(next);return {ok:true,revision,saved:row.recommendation};
  });
  if(path.endsWith('/material'))return enqueue(async()=>{
   const name=String(body.name||'').trim(),n=Number(body.difficulty);if(!name||name.length>40||!Number.isInteger(n)||n<1||n>5)throw new Error('재료 난이도는 1~5입니다.');
   const next=structuredClone(snapshot);next.materials ||= {};next.materials[name]={difficulty:n};next.tagCatalog ||= {};next.tagCatalog.materialTags=[...new Set([...(next.tagCatalog.materialTags||[]),name])];
   if(next.master)next.master.materials=structuredClone(next.materials);
   await commit(next);return {ok:true,revision};
  });
  throw new Error('지원되지 않는 요청');
 };
 $('signIn').onclick=async()=>{try{
  $('loginStatus').textContent='로그인 중...';const auth=await request('/auth/v1/token?grant_type=password',{email:$('email').value,password:$('password').value});if(snapshot&&userId&&auth.user?.id!==userId)throw new Error('편집 중인 계정으로 다시 로그인해주세요.');setSession(auth);$('password').value='';
  if(!snapshot)await load();$('login').hidden=true;$('app').hidden=false;
  if(!document.querySelector('script[data-editor]')){const script=document.createElement('script');script.src='editor.js?v=86';script.dataset.editor='1';document.body.append(script);}else if(window.KCEM_EDITOR_SAVE_PENDING){await window.KCEM_EDITOR_SAVE_PENDING();}
 }catch(e){$('loginStatus').textContent=e.message;}};
 $('signOut').onclick=()=>location.reload();
 $('importFile').onchange=async()=>{try{
  const next=JSON.parse(await $('importFile').files[0].text());
  if(!next.records?.length||next.records.some(x=>!x.program?.tid||!x.recommendation))throw new Error('올바른 이관 파일이 아닙니다.');
  if(snapshot?.records?.length)throw new Error('이미 이관된 DB는 덮어쓸 수 없습니다. 웹 에디터에서 수정하세요.');
  next.materials ||= next.master?.materials||{};await enqueue(()=>commit(next));alert('이관 완료. 다시 로그인하면 목록이 표시됩니다.');
 }catch(e){alert(e.message);}};
 $('publish').onclick=async()=>{try{
  if(window.KCEM_EDITOR_SAVE_PENDING && !await window.KCEM_EDITOR_SAVE_PENDING())throw new Error('저장에 실패한 입력이 있습니다. 저장 완료 후 다시 게시하세요.');
  await enqueue(async()=>{
   if(window.KCEM_CRAFT_META){
    const next=structuredClone(snapshot);
    for(const row of next.records){row.recommendation=window.KCEM_CRAFT_META.prepareRecommendation(row.program,row.recommendation);if(next.master){next.master.records ||= {};next.master.records[row.program.tid]={...next.master.records[row.program.tid],...structuredClone(row.recommendation)};}}
    if(JSON.stringify(next)!==JSON.stringify(snapshot))await commit(next);
   }
   return request('/rest/v1/rpc/kcem_craft_publish',{expected_revision:revision});
  });alert('게시 완료. 키오스크 시작 또는 수동 동기화 시 반영됩니다.');}catch(e){alert(e.message);}};
})();

