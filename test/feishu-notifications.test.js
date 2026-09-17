'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const {createNotifier,webhook,sign,STATES}=require('../feishu-notifications');
const url='https://open.feishu.cn/open-apis/bot/v2/hook/11111111-2222-3333-4444-555555555555';
const profile={id:'one',name:'App One',packageName:'com.one'};
const protect=(value,decrypt)=>decrypt?Buffer.from(value,'base64').toString():Buffer.from(value).toString('base64');
function fixture(t,fetchImpl){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'gp-notify-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));let time=1700000000000;const options={file:path.join(dir,'notifications.json'),protect,fetchImpl,now:()=>time};return {options,make:()=>createNotifier(options),advance:()=>time+=1000};}
test('Feishu configuration validates destination, hides saved secrets and signs messages',async t=>{
  let body,calls=0;
  const f=fixture(t,async(target,opts)=>{calls++;assert.equal(target,url);assert.equal(opts.redirect,'error');body=JSON.parse(opts.body);return Response.json({code:0});}),n=f.make();
  assert.throws(()=>webhook('http://127.0.0.1/hook'),/仅支持/);
  assert.throws(()=>webhook(url+'?token=bad'),/仅支持/);
  const result=n.configure(profile,{enabled:true,states:STATES,webhook:url,secret:'signing-secret'});
  assert.equal(result.hasWebhook,true);assert.equal(result.hasSecret,true);assert(!JSON.stringify(result).includes('signing-secret'));assert(!fs.readFileSync(f.options.file,'utf8').includes(url));
  await n.test(profile);assert.equal(calls,1);assert.equal(body.sign,sign(body.timestamp,'signing-secret'));assert.match(body.content.text,/不代表应用已过审/);
  assert.equal(n.status(profile).deliveries[0].status,'sent');
  n.configure(profile,{enabled:true,states:STATES,webhook:'',secret:'',clearSecret:true});await n.test(profile);assert.equal(body.sign,undefined);
  assert.equal(n.status({...profile,id:'two'}).hasWebhook,false);
});
test('approval notifications are durable, deduplicated and never backfill pre-enable events',async t=>{
  let calls=0;
  const f=fixture(t,async()=>{calls++;return Response.json({code:0});});let n=f.make();
  n.configure(profile,{enabled:true,states:STATES,webhook:url});f.advance();
  const event={id:'event-one',at:new Date(f.options.now()).toISOString(),track:'production',name:'1.0',versionCodes:['10'],after:STATES[0]};
  await n.process(profile,[{...event,id:'old',at:'2020-01-01T00:00:00Z'},event]);assert.equal(calls,1);
  await n.process(profile,[event]);n=f.make();await n.process(profile,[event]);assert.equal(calls,1);
  n.configure(profile,{enabled:false,states:STATES});await n.process(profile,[{...event,id:'event-two'}]);assert.equal(calls,1);
});
test('timeouts remain uncertain without automatic retry; explicit retry records success',async t=>{
  let calls=0,fail=true;
  const f=fixture(t,async()=>{calls++;if(fail)throw Error('network includes secret that must not leak');return Response.json({code:0});}),n=f.make();
  n.configure(profile,{enabled:true,states:STATES,webhook:url});const s=await n.test(profile);
  assert.equal(s.deliveries[0].status,'uncertain');assert(!s.deliveries[0].error.includes('secret'));
  await n.process(profile,[]);assert.equal(calls,1);
  fail=false;await n.retry(profile,s.deliveries[0].id);assert.equal(calls,2);assert.equal(n.status(profile).deliveries[0].status,'sent');
  await assert.rejects(n.retry(profile,s.deliveries[0].id),/不可重试/);
});
test('Windows DPAPI can protect and restore webhook settings without returning plaintext', {skip:process.platform!=='win32'},t=>{
  const f=fixture(t,async()=>Response.json({code:0}));f.options.protect=require('../credentials').protect;
  const n=f.make();n.configure(profile,{enabled:true,states:STATES,webhook:url,secret:'dpapi-secret'});
  assert(!fs.readFileSync(f.options.file,'utf8').includes('dpapi-secret'));
  n.configure(profile,{enabled:false,states:STATES,webhook:'',secret:''});assert.equal(n.status(profile).hasSecret,true);
});
