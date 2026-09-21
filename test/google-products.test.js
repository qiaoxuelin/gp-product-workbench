'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {createGoogleProducts}=require('../google-products');
const schemas=require('../google-api-discovery.json').schemas;
function service(){
  let profile={id:'a',packageName:'com.test.a'};
  const saved=new Map();
  const products=createGoogleProducts({getProfile:()=>profile,schemas,
    google:()=>{throw Error('Demo must not access Google');},
    read:(name,fallback)=>saved.get(name)||fallback,save:(name,value)=>saved.set(name,value)});
  return {products,switchProfile:()=>{profile={id:'b',packageName:'com.test.b'};}};
}
test('product service instances isolate demo data and one-use preview plans',async()=>{
  const a=service().products,b=service().products;
  const before=(await a.listProducts('demo'))[0],after=structuredClone(before);
  after.listings[0].title='Updated';
  const plan=await a.preview({mode:'demo',items:[{before,after}]});
  const request={id:plan.id,mode:plan.mode,packageName:plan.packageName};
  await assert.rejects(b.commit(request),/预览已失效/);
  assert.equal((await a.commit(request)).results[0].status,'verified');
  assert.equal((await b.listProducts('demo'))[0].listings[0].title,before.listings[0].title);
  await assert.rejects(a.commit(request),/预览已失效/);
});
test('profile changes and explicit invalidation reject outstanding previews',async()=>{
  const context=service(),a=context.products;
  const before=(await a.listProducts('demo'))[0],after=structuredClone(before);
  after.listings[0].title='Updated';
  let plan=await a.preview({mode:'demo',items:[{before,after}]});
  context.switchProfile();
  await assert.rejects(a.commit({id:plan.id,mode:plan.mode,packageName:plan.packageName}),/连接设置已变化/);
  plan=await a.preview({mode:'demo',items:[{before,after}]});
  a.invalidate();
  await assert.rejects(a.commit({id:plan.id,mode:plan.mode,packageName:plan.packageName}),/预览已失效/);
});
