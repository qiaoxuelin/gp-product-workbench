'use strict';
const crypto=require('node:crypto');
const Credentials=require('./apple-credentials'),Products=require('./apple-products');
function createAppleWorkspace({data,read,save,client:injectedClient}){
 let settings=read('apple-config.json',{profiles:[],activeId:''});
 const client=injectedClient||require('./apple-client').createAppleClient({loadCredential:p=>Credentials.load(data,p)});
 const products=Products.createAppleProducts({client,read,save});
 const publicSettings=()=>({platform:'apple',profiles:settings.profiles.map(Credentials.publicProfile),activeId:settings.activeId,current:Credentials.publicProfile(settings.profiles.find(p=>p.id===settings.activeId)||{})});
 async function route(url,b){
  if(url==='/api/apple/config')return publicSettings();
  if(url==='/api/apple/config/save'){
   if(typeof b.name!=='string'||!b.name.trim()||b.name.length>100)throw Error('请填写项目名称，最多 100 字符');
   if(!/^[0-9]{1,20}$/.test(b.appId||''))throw Error('App Apple ID 应为应用信息页中的数字 ID');
   if(typeof b.bundleId!=='string'||! /^[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+$/.test(b.bundleId))throw Error('Bundle ID 格式错误');
   if(!/^[A-Z0-9]{10}$/.test(b.keyId||''))throw Error('Key ID 应为 10 位大写字母或数字');
   if(!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(b.issuerId||''))throw Error('请填写团队 API Key 的 Issuer ID');
   if(b.privateKey!==undefined&&typeof b.privateKey!=='string')throw Error('.p8 内容格式错误');
   const old=settings.profiles.find(p=>p.id===b.id);if(b.id&&!old)throw Error('苹果项目不存在');
   if(old&&(old.appId!==b.appId||old.bundleId!==b.bundleId))throw Error('已有项目的应用标识不可更改；请新建项目');
   if(old?.credentialFile&&(old.keyId!==b.keyId||old.issuerId!==b.issuerId)&&!b.privateKey?.trim())throw Error('修改 Key ID 或 Issuer ID 时请同时导入匹配的 .p8 私钥');
   const imported=b.privateKey?.trim()?Credentials.store(data,b.privateKey):null;
   const next={...old,id:old?.id||crypto.randomUUID(),platform:'apple',name:b.name.trim(),appId:b.appId,bundleId:b.bundleId,keyId:b.keyId,issuerId:b.issuerId,...imported};
   const updated={profiles:[...settings.profiles.filter(p=>p.id!==next.id),next],activeId:next.id};
   try{save('apple-config.json',updated);}catch(e){if(imported)Credentials.remove(data,imported.credentialFile);throw e;}
   settings=updated;client.invalidate();products.invalidate();if(imported&&old?.credentialFile)Credentials.remove(data,old.credentialFile);return publicSettings();
  }
  if(url==='/api/apple/config/switch'){
   if(!settings.profiles.some(p=>p.id===b.id))throw Error('苹果项目不存在');
   const next={...settings,activeId:b.id};save('apple-config.json',next);settings=next;client.invalidate();products.invalidate();return publicSettings();
  }
  const p=settings.profiles.find(p=>p.id===settings.activeId);
  if(b.platform!=='apple'||!p||b.profileId!==p.id||b.appId!==p.appId)throw Error('苹果项目已切换或目标不一致，请重新读取');
  if(url==='/api/apple/validate'){Products.validate(b.product);return {valid:true};}
  if(url==='/api/apple/import'){if(!Array.isArray(b.existing))throw Error('商品列表无效');b.existing.forEach(Products.validate);return {products:Products.importCSV(b.csv,b.existing)};}
  if(url==='/api/apple/export'){if(!Array.isArray(b.products))throw Error('商品列表无效');b.products.forEach(Products.validate);return {csv:Products.exportCSV(b.products)};}
  if(url==='/api/apple/products')return {products:await products.list(p)};
  if(url==='/api/apple/preview')return products.preview(p,b.items);
  if(url==='/api/apple/commit')return products.commit(p,b);
  if(url==='/api/apple/history')return {operations:products.history(p)};
  if(url==='/api/apple/reconcile')return products.reconcile(p,b.logFile);
  throw Error('未知苹果接口');
 }
 return {route,publicSettings};
}
module.exports={createAppleWorkspace};
