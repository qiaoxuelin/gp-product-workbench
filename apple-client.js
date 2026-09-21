'use strict';
const crypto=require('node:crypto');
const ORIGIN='https://api.appstoreconnect.apple.com';
function createAppleClient({loadCredential,fetch:fetcher=(...args)=>globalThis.fetch(...args)}){
  const tokens=new Map();
  function token(profile){
    const identity=JSON.stringify([profile.id,profile.keyId,profile.issuerId,profile.credentialFile]);
    const cached=tokens.get(identity),now=Math.floor(Date.now()/1000);
    if(cached&&cached.expires>now+60)return cached.value;
    const b64=x=>Buffer.from(JSON.stringify(x)).toString('base64url');
    const input=b64({alg:'ES256',kid:profile.keyId,typ:'JWT'})+'.'+b64({iss:profile.issuerId,iat:now,exp:now+600,aud:'appstoreconnect-v1'});
    const signature=crypto.sign('sha256',Buffer.from(input),{key:loadCredential(profile),dsaEncoding:'ieee-p1363'}).toString('base64url');
    const value=input+'.'+signature;tokens.set(identity,{value,expires:now+600});return value;
  }
  async function request(profile,method,endpoint,body){
    const url=new URL(endpoint,ORIGIN);
    if(url.origin!==ORIGIN||url.username||url.password||!/^\/v[12]\//.test(url.pathname))throw Error('苹果 API 地址无效');
    const response=await fetcher(url.href,{method,headers:{Authorization:'Bearer '+token(profile),'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),redirect:'error',signal:AbortSignal.timeout(45000)});
    const raw=await response.text();let result;try{result=raw?JSON.parse(raw):{};}catch{throw Error('Apple 返回非 JSON 响应，HTTP '+response.status);}
    if(!response.ok){const e=Error('Apple '+response.status+'：'+(result.errors||[]).map(e=>e.detail||e.title||e.code).join('；').slice(0,2000));e.status=response.status;throw e;}return result;
  }
  async function list(profile,endpoint){
    const data=[],seen=new Set();let next=endpoint;
    while(next){if(seen.has(next)||seen.size>=1000)throw Error('Apple 分页异常，请缩小读取范围');seen.add(next);const page=await request(profile,'GET',next);if(!Array.isArray(page.data))throw Error('Apple 列表响应格式错误');data.push(...page.data);next=page.links?.next;}
    return data;
  }
  return {request,list,invalidate:()=>tokens.clear()};
}
module.exports={createAppleClient};
