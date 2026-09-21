'use strict';
const crypto=require('node:crypto');
const Finance=require('./finance');
// Credentials and active profile belong to the application, not the transport.
function createGoogleClient({loadCredential,getProfile,fetch:request=(...args)=>globalThis.fetch(...args)}) {
  let tokenCache=null;
async function accessToken(scope='https://www.googleapis.com/auth/androidpublisher',profile=getProfile()) {
  if(!['https://www.googleapis.com/auth/androidpublisher',Finance.SCOPE].includes(scope))throw Error('授权范围无效');
  const identity=JSON.stringify([profile.id,profile.credentialFile,profile.credentialPath]);
  if(tokenCache&&tokenCache.identity===identity&&tokenCache.scope===scope&&tokenCache.expires>Date.now()+60000)return tokenCache.token;
  const key=loadCredential(profile);
  const now=Math.floor(Date.now()/1000), b64=v=>Buffer.from(JSON.stringify(v)).toString('base64url');
  const unsigned=b64({alg:'RS256',typ:'JWT'})+'.'+b64({iss:key.client_email,scope,aud:'https://oauth2.googleapis.com/token',iat:now,exp:now+3600});
  let signature;try{signature=crypto.sign('RSA-SHA256',Buffer.from(unsigned),key.private_key).toString('base64url');}catch{throw Error('服务账号私钥无效');}
  const response=await request('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'urn:ietf:params:oauth:grant-type:jwt-bearer',assertion:unsigned+'.'+signature}),signal:AbortSignal.timeout(30000),redirect:'error'});
  const result=await response.json();
  if(!response.ok)throw Error('Google 授权失败：'+(result.error_description||result.error||response.status));
  tokenCache={identity,scope,token:result.access_token,expires:Date.now()+Number(result.expires_in||3600)*1000};
  return tokenCache.token;
}
async function google(method,suffix,body,profile=getProfile()) {
  const token=await accessToken('https://www.googleapis.com/auth/androidpublisher',profile);
  const response=await request('https://androidpublisher.googleapis.com/androidpublisher/v3/applications/'+encodeURIComponent(profile.packageName)+suffix,{
    method,headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(45000),redirect:'error'});
  const raw=await response.text();let result;try{result=raw?JSON.parse(raw):{};}catch{throw Error('Google 返回非 JSON 响应，HTTP '+response.status);}
  if(!response.ok){const e=Error('Google '+response.status+'：'+(result.error?.message||'请求失败'));e.status=response.status;throw e;}
  return result;
}

  return {accessToken,request:google,invalidate:()=>{tokenCache=null;}};
}
module.exports={createGoogleClient};
