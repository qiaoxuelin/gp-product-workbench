'use strict';
const crypto=require('node:crypto');
const C=require('./core');
const {checkTransitions,projectContains}=require('./google-product-rules');
// Google product semantics stay here; Apple must not inherit purchase-option states.
function createGoogleProducts({getProfile,google,read,save,schemas:SCHEMAS}) {
const plans=new Map();
function seed() {
  return [ ['coins_100','金币小礼包','100 coins','0.99','7'],['coins_550','金币超值礼包','550 coins','4.99','39'],['remove_ads','永久去广告','Remove ads','2.99','23'] ].map(([id,title,desc,usd,hkd])=>({
    packageName:'com.example.demo',productId:id,regionsVersion:{version:'demo'},
    listings:[{languageCode:'zh-CN',title,description:desc},{languageCode:'en-US',title:desc,description:desc}],
    purchaseOptions:[{purchaseOptionId:'buy',state:'ACTIVE',buyOption:{legacyCompatible:true},regionalPricingAndAvailabilityConfigs:[
      {regionCode:'US',price:C.money(usd,'USD'),availability:'AVAILABLE'},
      {regionCode:'HK',price:C.money(hkd,'HKD'),availability:'AVAILABLE'}]}]
  }));
}
let demo=read('demo.json',seed());
function packageFor(mode){if(!['demo','live'].includes(mode))throw Error('请选择演示或真实模式');if(mode==='demo')return 'com.example.demo';if(!getProfile().packageName)throw Error('请先设置应用包名');return getProfile().packageName;}
async function getProduct(mode,id) {
  if(mode==='demo')return C.clone(demo.find(p=>p.productId===id)||null);
  try{return await google('GET','/oneTimeProducts/'+encodeURIComponent(id));}catch(e){if(e.status===404)return null;throw e;}
}
async function listProducts(mode) {
  packageFor(mode);
  if(mode==='demo')return C.clone(demo);
  const result=[];let page='';
  do{
    const data=await google('GET','/oneTimeProducts?pageSize=1000'+(page?'&pageToken='+encodeURIComponent(page):''));
    result.push(...data.oneTimeProducts||[]);page=data.nextPageToken||'';
  }while(page);
  return result;
}
async function conversion(mode,price,category) {
  if(mode==='demo')throw Error('Google 地区换算需要真实授权；演示模式可试用指定价格和比例调价');
  return google('POST','/pricing:convertRegionPrices',{price,...(category?{productTaxCategoryCode:category}:{})});
}
async function preview(body) {
  const mode=body.mode, pkg=packageFor(mode),items=body.items;
  if(!Array.isArray(items)||!items.length||items.length>500)throw Error('每次请选择 1–500 个商品');
  if(new Set(items.map(x=>x.after?.productId)).size!==items.length)throw Error('商品 ID 重复');
  const entries=[];
  let latestVersion=null;
  for(const item of items) {
    const after=C.clone(item.after);C.validate(after,SCHEMAS);
    if(after.packageName!==pkg)throw Error('商品包名与当前应用不一致');
    const before=item.before||null;
    const remote=await getProduct(mode,after.productId);
    if(!C.equal(before,remote))throw Error(after.productId+'：远端数据已改变或商品 ID 已存在。请刷新商品后重新编辑');
    const states=item.states||{};checkTransitions(before,after,states);
    const updateMask=C.mask(before,after);
    if(!updateMask.length&&!Object.keys(states).some(id=>before?.purchaseOptions.find(o=>o.purchaseOptionId===id)?.state!==states[id]))continue;
    let regionsVersion=after.regionsVersion||remote?.regionsVersion;
    if(!regionsVersion?.version){
      if(mode==='demo')regionsVersion={version:'demo'};
      else {
        if(!latestVersion)latestVersion=(await conversion(mode,C.money('1','USD'))).regionVersion;
        regionsVersion=latestVersion;
      }
    }
    if(!regionsVersion?.version)throw Error('Google 未返回地区版本，无法提交');
    entries.push({before,after,states,updateMask,regionsVersion,changes:C.changes(C.writable(before||{}),C.writable(after)).concat(Object.entries(states).filter(([id,v])=>before?.purchaseOptions.find(o=>o.purchaseOptionId===id)?.state!==v).map(([id,v])=>({path:'purchaseOptions.'+id+'.state',before:before?.purchaseOptions.find(o=>o.purchaseOptionId===id)?.state,after:v})))});
  }
  if(!entries.length)throw Error('没有需要提交的变化');
  const id=crypto.randomUUID();
  for(const [k,p] of plans)if(p.expires<Date.now())plans.delete(k);
  const plan={id,mode,packageName:pkg,configHash:C.hash(getProfile()),entries,expires:Date.now()+15*60000};
  plans.set(id,plan);
  return {id,mode,packageName:pkg,expires:plan.expires,entries};
}
async function commit(body) {
  const plan=plans.get(body.id);
  if(!plan||plan.expires<Date.now())throw Error('预览已失效，请重新生成');
  if(body.packageName!==plan.packageName||body.mode!==plan.mode)throw Error('提交目标与预览不一致');
  if(plan.configHash!==C.hash(getProfile()))throw Error('连接设置已变化，请重新预览');
  plans.delete(plan.id);
  const record={id:plan.id,mode:plan.mode,profileId:plan.mode==='live'?getProfile().id:null,packageName:plan.packageName,startedAt:new Date().toISOString(),entries:plan.entries,results:[]};
  const logName='operation-'+Date.now()+'-'+plan.id+'.json';
  save(logName,record);
  for(const e of plan.entries) {
    const id=e.after.productId;let wrote=false,confirmedWrite=false,stage='check';
    const steps={check:'pending',configuration:e.updateMask.length?'pending':'skipped',state:Object.keys(e.states).length?'pending':'skipped',readback:'pending'};
    try{
      const fresh=await getProduct(plan.mode,id);
      if(!C.equal(fresh,e.before))throw Error('远端已变化，未写入；请刷新后重新编辑');
      steps.check='success';
      if(plan.mode==='demo'){
        let next=C.clone(e.after);next.regionsVersion=e.regionsVersion;
        for(const o of next.purchaseOptions)o.state=e.states[o.purchaseOptionId]||e.before?.purchaseOptions.find(x=>x.purchaseOptionId===o.purchaseOptionId)?.state||'DRAFT';
        demo=demo.filter(p=>p.productId!==id);demo.push(next);save('demo.json',demo);wrote=true;
        steps.configuration=e.updateMask.length?'success':'skipped';steps.state=Object.keys(e.states).length?'success':'skipped';
      }else{
        if(e.updateMask.length){
          stage='configuration';wrote=true;
          await google('POST','/oneTimeProducts:batchUpdate',{requests:[{oneTimeProduct:C.writable(e.after),updateMask:e.updateMask.join(','),regionsVersion:e.regionsVersion,allowMissing:!e.before}]});
          confirmedWrite=true;steps.configuration='success';
        }
        const requests=Object.entries(e.states).filter(([oid,target])=>e.before?.purchaseOptions.find(o=>o.purchaseOptionId===oid)?.state!==target).map(([oid,target])=>({
          [target==='ACTIVE'?'activatePurchaseOptionRequest':'deactivatePurchaseOptionRequest']:{packageName:plan.packageName,productId:id,purchaseOptionId:oid}
        }));
        if(requests.length){stage='state';wrote=true;for(let i=0;i<requests.length;i+=100){await google('POST','/oneTimeProducts/'+encodeURIComponent(id)+'/purchaseOptions:batchUpdateStates',{requests:requests.slice(i,i+100)});confirmedWrite=true;}steps.state='success';}
      }
      stage='readback';
      const actual=await getProduct(plan.mode,id);
      const fieldsOK=e.updateMask.every(k=>projectContains(C.writable(actual||{})[k],C.writable(e.after)[k]));
      const statesOK=Object.entries(e.states).every(([oid,t])=>actual?.purchaseOptions.find(o=>o.purchaseOptionId===oid)?.state===t);
      steps.readback=fieldsOK&&statesOK?'success':'pending';
      record.results.push({productId:id,steps,status:fieldsOK&&statesOK?'verified':'pending',message:fieldsOK&&statesOK?'已提交并读回核对；购买选项：'+actual.purchaseOptions.map(o=>o.purchaseOptionId+' '+({ACTIVE:'已启用',DRAFT:'草稿（未启用）',INACTIVE:'已停用'}[o.state]||o.state)).join('、'):'已提交，读回尚未完全一致，请刷新核对后再决定是否重试',actual});
    }catch(err){
      steps[stage]=[400,401,403,404].includes(err.status)||!wrote?'failed':'uncertain';
      const rejected=!confirmedWrite&&[400,401,403,404].includes(err.status);
      const uncertain=wrote&&!rejected;
      const hint=/request billing permission/i.test(err.message)?' 处理建议：核对目标包名 '+plan.packageName+'，并检查上传到 Play Console 的应用包是否声明 com.android.vending.BILLING；这不是单纯增加服务账号管理权限可以解决的问题。':'';
      record.results.push({productId:id,steps,status:uncertain?'uncertain':'failed',message:(uncertain?'可能已部分写入，请先刷新核对。':rejected?'Google 已拒绝此请求，未写入。':'')+err.message+hint});
    }
    save(logName,record);
  }
  record.finishedAt=new Date().toISOString();save(logName,record);
  return {results:record.results,logFile:logName};
}

async function recoverOperation(b){
  if(!/^operation-[a-zA-Z0-9-]+\.json$/.test(b.logFile||''))throw Error('操作记录标识无效');
  const record=read(b.logFile,null);
  if(!record||record.mode!==b.mode||record.packageName!==packageFor(b.mode)||(b.mode==='live'&&record.profileId!==getProfile().id))throw Error('操作记录不属于当前项目，或旧记录无法自动核对');
  const entries=[],resolved=[],blocked=[];
  for(const result of record.results.filter(r=>r.status!=='verified')){
    const e=record.entries.find(x=>x.after.productId===result.productId);if(!e)continue;
    try{
      const actual=await getProduct(b.mode,result.productId);
      const fieldsOK=actual&&e.updateMask.every(k=>projectContains(C.writable(actual)[k],C.writable(e.after)[k]));
      const remaining=Object.fromEntries(Object.entries(e.states).filter(([id,state])=>actual?.purchaseOptions.find(o=>o.purchaseOptionId===id)?.state!==state));
      if(fieldsOK){
        if(!Object.keys(remaining).length)resolved.push({productId:result.productId,actual});
        else entries.push({before:actual,after:C.clone(actual),states:remaining,reason:'配置已核对，仅补做未完成的启用/停用'});
      }else if(C.equal(actual,e.before)){
        entries.push({before:actual,after:e.after,states:e.states,reason:'远端仍与原始版本一致，可重新预览未完成操作'});
      }else blocked.push({productId:result.productId,message:'远端配置与提交前和目标版本均不一致，请手动核对；未覆盖本地草稿'});
    }catch(err){blocked.push({productId:result.productId,message:err.message});}
  }
  return {entries,resolved,blocked};
}

return {packageFor,getProduct,listProducts,conversion,preview,commit,recoverOperation,invalidate:()=>plans.clear()};
}
module.exports={createGoogleProducts};
