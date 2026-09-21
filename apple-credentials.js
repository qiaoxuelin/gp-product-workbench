'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {protect}=require('./credentials');
function validateKey(text){
  if(typeof text!=='string'||Buffer.byteLength(text)>65536)throw Error('请选择不超过 64KB 的 .p8 私钥');
  let key;try{key=crypto.createPrivateKey(text);}catch{throw Error('苹果 .p8 私钥格式错误');}
  if(key.asymmetricKeyType!=='ec'||key.asymmetricKeyDetails?.namedCurve!=='prime256v1')throw Error('苹果 API 私钥需要 P-256 椭圆曲线');
  return text.trim();
}
function credentialPath(data,file){
  if(!/^apple-credential-[a-f0-9-]+\.dpapi$/.test(file||''))throw Error('苹果凭据标识无效');
  return path.join(data,file);
}
function store(data,text){
  const encrypted=protect(validateKey(text)),file='apple-credential-'+crypto.randomUUID()+'.dpapi';
  fs.writeFileSync(credentialPath(data,file),encrypted,{flag:'wx',mode:0o600});
  return {credentialFile:file,credentialUpdatedAt:new Date().toISOString()};
}
function load(data,p){if(!p.credentialFile)throw Error('请先导入 App Store Connect API 的 .p8 私钥');return validateKey(protect(fs.readFileSync(credentialPath(data,p.credentialFile),'utf8'),true));}
function remove(data,file){try{fs.unlinkSync(credentialPath(data,file));}catch{}}
function publicProfile(p){return {id:p.id,platform:'apple',name:p.name,appId:p.appId,bundleId:p.bundleId,keyId:p.keyId,issuerId:p.issuerId,hasCredential:Boolean(p.credentialFile),credentialUpdatedAt:p.credentialUpdatedAt||''};}
module.exports={validateKey,store,load,remove,publicProfile};
