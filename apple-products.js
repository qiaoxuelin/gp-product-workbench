'use strict';
const crypto=require('node:crypto'),C=require('./core');
const TYPES=['CONSUMABLE','NON_CONSUMABLE'],enc=encodeURIComponent,link=(type,id)=>({data:{type,id}});
function editable(p){return {productId:p.productId,name:p.name,inAppPurchaseType:p.inAppPurchaseType,reviewNote:p.reviewNote||'',localizations:(p.localizations||[]).map(({locale,name,description})=>({locale,name,description:description||''})).sort((a,b)=>a.locale.localeCompare(b.locale))};}
function validate(p){
 if(!p||typeof p!=='object'||Array.isArray(p))throw Error('苹果商品格式错误');
 for(const k of Object.keys(p))if(!['productId','name','inAppPurchaseType','reviewNote','localizations','initialPrice'].includes(k))throw Error('不支持的苹果商品字段：'+k);
 if(!/^[A-Za-z0-9._-]{1,100}$/.test(p.productId||''))throw Error('商品 ID 仅支持字母、数字、点、下划线、连字符，最多 100 字符');
 if(!TYPES.includes(p.inAppPurchaseType))throw Error('仅支持消耗型与非消耗型内购');
 if(typeof p.name!=='string'||!p.name.trim()||[...p.name].length>64)throw Error('参考名称不能为空，最多 64 字符');
 if(p.reviewNote!==undefined&&(typeof p.reviewNote!=='string'||[...p.reviewNote].length>4000))throw Error('审核备注最多 4000 字符');
 if(!Array.isArray(p.localizations)||p.localizations.length>100)throw Error('多语言格式错误或超过 100 种');
 const seen=new Set();for(const l of p.localizations){
  if(!l||Object.keys(l).some(k=>!['locale','name','description'].includes(k)))throw Error('多语言字段无效');
  if(typeof l.locale!=='string'||! /^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8}){0,2}$/.test(l.locale)||seen.has(l.locale))throw Error('语言代码无效或重复');seen.add(l.locale);
  if(typeof l.name!=='string'||[...l.name.trim()].length<2||[...l.name].length>30)throw Error(l.locale+' 显示名称需要 2–30 字符');
  if(typeof l.description!=='string'||!l.description.trim()||[...l.description].length>45)throw Error(l.locale+' 描述不能为空且最多 45 字符');
 }
 if(p.initialPrice){const v=p.initialPrice;if(Object.keys(v).some(k=>!['territory','currency','price'].includes(k))||! /^[A-Z]{3}$/.test(v.territory||'')||! /^[A-Z]{3}$/.test(v.currency||'')||typeof v.price!=='string'||! /^\d{1,7}(\.\d{1,2})?$/.test(v.price))throw Error('初始价格需要三位地区、币种和非负金额');}
 return editable(p);
}
function importCSV(text,existing=[]){
 const rows=C.parseCSV(text);if(!rows.length||rows.length>5000)throw Error('CSV 需要 1–5000 行');const map=new Map(),seen=new Map();
 for(const r of rows){
  for(const h of ['productId','name','inAppPurchaseType','locale','displayName','description'])if(!(h in r))throw Error('苹果 CSV 缺少列：'+h);
  const id=r.productId,previous=existing.find(x=>x.productId===id),identity=JSON.stringify([r.name,r.inAppPurchaseType,r.reviewNote||'',r.territory||'',r.currency||'',r.price||'']);
  if(seen.has(id)&&seen.get(id)!==identity)throw Error(id+' 的重复行基础字段不一致');seen.set(id,identity);
  let p=map.get(id);if(!p){p=previous?structuredClone(previous):{productId:id,localizations:[]};Object.assign(p,{name:r.name,inAppPurchaseType:r.inAppPurchaseType});if('reviewNote' in r)p.reviewNote=r.reviewNote;else p.reviewNote=p.reviewNote||'';
   if(r.price||r.territory||r.currency)p.initialPrice={territory:r.territory,currency:r.currency,price:r.price};map.set(id,p);}
  if(r.locale||r.displayName||r.description){const l={locale:r.locale,name:r.displayName,description:r.description},key=id+'\0'+r.locale,prior=seen.get(key);if(prior&&prior!==JSON.stringify(l))throw Error(id+' '+r.locale+' 重复文案不一致');seen.set(key,JSON.stringify(l));p.localizations=p.localizations.filter(x=>x.locale!==r.locale).concat(l);}
 }
 const result=[...map.values()];result.forEach(validate);return result;
}
function exportCSV(products){
 const headers=['productId','name','inAppPurchaseType','reviewNote','locale','displayName','description','territory','currency','price'];
 const rows=products.flatMap(p=>(p.localizations.length?p.localizations:[{}]).map(l=>[p.productId,p.name,p.inAppPurchaseType,p.reviewNote,l.locale,l.name,l.description,p.initialPrice?.territory,p.initialPrice?.currency,p.initialPrice?.price]));
 return '\uFEFF'+[headers,...rows].map(r=>r.map(x=>'"'+String(x??'').replace(/"/g,'""')+'"').join(',')).join('\r\n');
}
function createAppleProducts({client,read,save}){
 const plans=new Map(),request=(p,m,e,b)=>client.request(p,m,e,b);
 async function verifyApp(p){const r=await request(p,'GET','/v1/apps/'+enc(p.appId));if(r.data?.attributes?.bundleId!==p.bundleId)throw Error('Apple ID 与 Bundle ID 不匹配，未继续操作');return r.data;}
 async function hydrate(p,r){
  const versions=await client.list(p,'/v2/inAppPurchases/'+enc(r.id)+'/versions?limit=50');
  const version=versions.sort((a,b)=>Number(b.attributes.version)-Number(a.attributes.version))[0];
  const locales=await client.list(p,version?'/v1/inAppPurchaseVersions/'+enc(version.id)+'/localizations?limit=50':'/v2/inAppPurchases/'+enc(r.id)+'/inAppPurchaseLocalizations?limit=50');
  let priceSchedule=null;
  try{const s=await request(p,'GET','/v2/inAppPurchases/'+enc(r.id)+'/iapPriceSchedule?include=baseTerritory');if(s.data){const prices=await client.list(p,'/v1/inAppPurchasePriceSchedules/'+enc(s.data.id)+'/manualPrices?include=inAppPurchasePricePoint,territory&limit=200');priceSchedule={id:s.data.id,baseTerritory:s.data.relationships?.baseTerritory?.data?.id,prices:prices.map(x=>({id:x.id,startDate:x.attributes?.startDate||null,endDate:x.attributes?.endDate||null,pointId:x.relationships?.inAppPurchasePricePoint?.data?.id,territory:x.relationships?.territory?.data?.id})).sort((a,b)=>a.id.localeCompare(b.id))};}}catch(e){if(e.status!==404)throw e;}
  return {id:r.id,productId:r.attributes.productId,name:r.attributes.name,inAppPurchaseType:r.attributes.inAppPurchaseType,reviewNote:r.attributes.reviewNote||'',state:r.attributes.state,version:version?{id:version.id,state:version.attributes.state,number:version.attributes.version}:null,localizations:locales.map(l=>({id:l.id,locale:l.attributes.locale,name:l.attributes.name,description:l.attributes.description||''})).sort((a,b)=>a.locale.localeCompare(b.locale)),priceSchedule};
 }
 async function find(p,id){const matches=await client.list(p,'/v1/apps/'+enc(p.appId)+'/inAppPurchasesV2?filter%5BproductId%5D='+enc(id)+'&limit=200');const r=matches.find(r=>r.attributes.productId===id);return r?hydrate(p,r):null;}
 async function list(p){await verifyApp(p);const rows=await client.list(p,'/v1/apps/'+enc(p.appId)+'/inAppPurchasesV2?limit=200'),result=[];for(const r of rows)if(TYPES.includes(r.attributes.inAppPurchaseType))result.push(await hydrate(p,r));return result;}
 async function verifyPriceTerritory(p,price){
  const territory=await request(p,'GET','/v1/territories/'+enc(price.territory));if(territory.data?.attributes?.currency!==price.currency)throw Error('币种与 Apple 地区币种不一致');
 }
 async function point(p,id,price){
  await verifyPriceTerritory(p,price);
  const rows=await client.list(p,'/v2/inAppPurchases/'+enc(id)+'/pricePoints?filter%5Bterritory%5D='+enc(price.territory)+'&limit=8000');
  const found=rows.filter(x=>Number(x.attributes.customerPrice)===Number(price.price));if(found.length!==1)throw Error('Apple 未返回唯一匹配价格档位：'+price.currency+' '+price.price+'；请调整金额后重新预览');return found[0].id;
 }
 function matchesPrice(actual,target,pointId){return actual?.priceSchedule?.baseTerritory===target.territory&&actual.priceSchedule.prices.some(x=>x.pointId===pointId&&!x.endDate&&(!x.startDate||x.startDate<=new Date().toISOString().slice(0,10)));}
 async function preview(p,items){
  if(!Array.isArray(items)||!items.length||items.length>100)throw Error('每批选择 1–100 个苹果商品');
  const ids=new Set();for(const item of items){validate(item.after);if(ids.has(item.after.productId))throw Error('商品 ID 重复');ids.add(item.after.productId);}
  await verifyApp(p);const entries=[],checkedTerritories=new Set();
  for(const {after} of items)if(after.initialPrice){const identity=after.initialPrice.territory+':'+after.initialPrice.currency;if(!checkedTerritories.has(identity)){await verifyPriceTerritory(p,after.initialPrice);checkedTerritories.add(identity);}}
  for(const item of items){const after=structuredClone(item.after),before=await find(p,after.productId);if(!C.equal(before,item.before||null))throw Error(after.productId+'：远端已变化或商品已存在，请先读取核对');
   if(before&&before.inAppPurchaseType!==after.inAppPurchaseType)throw Error('已创建商品不能修改内购类型');
   if(before?.localizations.some(l=>!after.localizations.some(x=>x.locale===l.locale)))throw Error('本版不删除已有语言，请保留原文案');
   const metadataChanged=!C.equal(editable(before||{}).localizations,editable(after).localizations);
   if(metadataChanged&&['READY_FOR_REVIEW','WAITING_FOR_REVIEW','IN_REVIEW'].includes(before?.version?.state))throw Error(after.productId+' 的文案版本正在审核，暂不修改');
   let pointId=null;if(after.initialPrice&&before){pointId=await point(p,before.id,after.initialPrice);if(before.priceSchedule&&!matchesPrice(before,after.initialPrice,pointId))throw Error('已有价格计划，本版只初始化价格；请在 App Store Connect 调价');}
   const changes=C.changes(before?editable(before):{},editable(after));if(after.initialPrice&&(!before||!matchesPrice(before,after.initialPrice,pointId)))changes.push({path:'initialPrice',before:null,after:after.initialPrice});
   if(changes.length)entries.push({before,after,changes,pointId});
  }
  if(!entries.length)throw Error('没有待提交修改');for(const [id,plan]of plans)if(plan.expires<Date.now())plans.delete(id);
  const plan={id:crypto.randomUUID(),platform:'apple',profileId:p.id,appId:p.appId,bundleId:p.bundleId,configHash:C.hash(p),expires:Date.now()+900000,entries};plans.set(plan.id,plan);return plan;
 }
 async function writeMetadata(p,actual,after,checkpoint){
  if(C.equal(editable(actual).localizations,editable(after).localizations))return;
  let version=actual.version;
  if(!version||version.state!=='PREPARE_FOR_SUBMISSION'){const result=await request(p,'POST','/v1/inAppPurchaseVersions',{data:{type:'inAppPurchaseVersions',relationships:{inAppPurchase:link('inAppPurchases',actual.id)}}});version={id:result.data.id};checkpoint('version');}
  const existing=await client.list(p,'/v1/inAppPurchaseVersions/'+enc(version.id)+'/localizations?limit=50');
  for(const l of after.localizations){const old=existing.find(x=>x.attributes.locale===l.locale);if(old&&C.equal({locale:old.attributes.locale,name:old.attributes.name,description:old.attributes.description||''},l))continue;
   await request(p,old?'PATCH':'POST','/v2/inAppPurchaseLocalizations'+(old?'/'+enc(old.id):''),{data:{type:'inAppPurchaseLocalizations',...(old?{id:old.id}:{}),attributes:old?{name:l.name,description:l.description}:l,...(old?{}:{relationships:{version:link('inAppPurchaseVersions',version.id)}})}});checkpoint('locale:'+l.locale);}
 }
 async function commit(p,b){
  const plan=plans.get(b.id);if(!plan||plan.expires<Date.now())throw Error('预览已失效，请重新预览');
  if(b.appId!==plan.appId||b.platform!=='apple'||p.id!==plan.profileId||C.hash(p)!==plan.configHash)throw Error('苹果提交目标或授权已变化');
  plans.delete(plan.id);await verifyApp(p);
  const record={...plan,startedAt:new Date().toISOString(),results:[]};delete record.configHash;
  const file='apple-operation-'+Date.now()+'-'+plan.id+'.json',history=read('apple-history.json',[]);save(file,record);save('apple-history.json',[file,...history].slice(0,100));
  for(const entry of plan.entries){let attempted=false,confirmed=false,stage='check';const completed=[];
   const checkpoint=s=>{confirmed=true;completed.push(s);save(file,record);};
   const result={productId:entry.after.productId,status:'pending',completed};record.results.push(result);save(file,record);
   try{let actual=await find(p,entry.after.productId);if(!C.equal(actual,entry.before))throw Error('远端已变化，未写入；请重新读取');const after=entry.after;
    if(!actual){stage='create';attempted=true;const r=await request(p,'POST','/v2/inAppPurchases',{data:{type:'inAppPurchases',attributes:{name:after.name,productId:after.productId,inAppPurchaseType:after.inAppPurchaseType,reviewNote:after.reviewNote||''},relationships:{app:link('apps',p.appId)}}});checkpoint('create');actual={id:r.data.id,...after,localizations:[],version:null,priceSchedule:null};}
    else if(actual.name!==after.name||actual.reviewNote!==(after.reviewNote||'')){stage='configuration';attempted=true;await request(p,'PATCH','/v2/inAppPurchases/'+enc(actual.id),{data:{type:'inAppPurchases',id:actual.id,attributes:{name:after.name,reviewNote:after.reviewNote||''}}});checkpoint('configuration');}
    stage='localizations';if(!C.equal(editable(actual).localizations,editable(after).localizations)){attempted=true;await writeMetadata(p,actual,after,checkpoint);}
    if(after.initialPrice){stage='price';const pointId=entry.pointId||await point(p,actual.id,after.initialPrice);entry.pointId=pointId;
     if(!matchesPrice(actual,after.initialPrice,pointId)){if(actual.priceSchedule)throw Error('已有价格计划，未覆盖');const priceId='$'+'{price-0}';attempted=true;await request(p,'POST','/v1/inAppPurchasePriceSchedules',{data:{type:'inAppPurchasePriceSchedules',relationships:{inAppPurchase:link('inAppPurchases',actual.id),baseTerritory:link('territories',after.initialPrice.territory),manualPrices:{data:[{type:'inAppPurchasePrices',id:priceId}]}}},included:[{type:'inAppPurchasePrices',id:priceId,attributes:{startDate:null},relationships:{inAppPurchaseV2:link('inAppPurchases',actual.id),inAppPurchasePricePoint:link('inAppPurchasePricePoints',pointId)}}]});checkpoint('price');}}
    stage='readback';result.actual=await find(p,after.productId);const ok=result.actual&&C.equal(editable(result.actual),editable(after))&&(!after.initialPrice||matchesPrice(result.actual,after.initialPrice,entry.pointId));result.status=ok?'verified':'pending';result.message=ok?'上传并读回核对完成；尚未送审':'读回尚未一致，请核对后再操作';
   }catch(e){const rejected=[400,401,403,404,409,422].includes(e.status);result.status=confirmed||attempted&&!rejected?'uncertain':'failed';result.message=(result.status==='uncertain'?'可能已部分写入，请先核对。':'')+e.message;result.stage=stage;}
   save(file,record);
  }
  record.finishedAt=new Date().toISOString();save(file,record);return {logFile:file,results:record.results};
 }
 function history(p){return read('apple-history.json',[]).map(file=>({file,...read(file,{})})).filter(r=>r.profileId===p.id&&r.appId===p.appId).map(({file,startedAt,results})=>({file,startedAt,results}));}
 async function reconcile(p,file){
  if(!/^apple-operation-[a-zA-Z0-9-]+\.json$/.test(file||''))throw Error('苹果记录标识无效');
  const record=read(file,null);
  if(!record||record.platform!=='apple'||record.profileId!==p.id||record.appId!==p.appId||record.bundleId!==p.bundleId)throw Error('记录不属于当前苹果项目');
  await verifyApp(p);const results=[];
  for(const entry of record.entries){
   const result={productId:entry.after.productId,target:entry.after,status:'pending'};
   try{
    result.actual=await find(p,entry.after.productId);
    let priceOK=!entry.after.initialPrice;
    if(result.actual&&entry.after.initialPrice){const priceId=entry.pointId||await point(p,result.actual.id,entry.after.initialPrice);priceOK=matchesPrice(result.actual,entry.after.initialPrice,priceId);}
    if(result.actual&&C.equal(editable(result.actual),editable(entry.after))&&priceOK)result.status='verified';
   }catch(error){result.message=error.message;}
   // A failed lookup must not masquerade as a missing remote product.
   result.canLoadCurrent=Object.hasOwn(result,'actual');results.push(result);
  }
  return {results};
 }

 return {list,preview,commit,history,reconcile,invalidate:()=>plans.clear()};
}
module.exports={createAppleProducts,validate,editable,importCSV,exportCSV};
