'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const {createNotifier,webhook,sign,STATES}=require('../feishu-notifications');
const url='https://open.feishu.cn/open-apis/bot/v2/hook/11111111-2222-3333-4444-555555555555';
const profile={id:'one',name:'App One',packageName:'com.one'};
const protect=(value,decrypt)=>decrypt?Buffer.from(value,'base64').toString():Buffer.from(value).toString('base64');
const inReview='RELEASE_LIFECYCLE_STATE_IN_REVIEW';
function fixture(t,fetchImpl){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'gp-notify-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));let time=1700000000000;const options={file:path.join(dir,'notifications.json'),protect,fetchImpl,now:()=>time};return {options,make:()=>createNotifier(options),advance:()=>time+=1000};}
test('in-review opt-in ignores past events and preserves deduplication across restart',async t=>{
  const bodies=[],f=fixture(t,async(_,opts)=>{bodies.push(JSON.parse(opts.body));return Response.json({code:0});});
  let n=f.make();const approved='RELEASE_LIFECYCLE_STATE_APPROVED_NOT_PUBLISHED';
  n.configure(profile,{enabled:true,states:[approved],webhook:url});
  const event={id:'past-review',at:new Date(f.options.now()).toISOString(),track:'production',name:'1.1',versionCodes:['11'],after:inReview};
  f.advance();n.configure(profile,{enabled:true,states:[approved,inReview]});
  await n.process(profile,[event]);assert.equal(bodies.length,0);
  f.advance();const fresh={...event,id:'new-review',at:new Date(f.options.now()).toISOString()};
  await n.process(profile,[fresh]);assert.equal(bodies.length,1);assert.match(bodies[0].content.text,/已提审，审核中/);
  n=f.make();await n.process(profile,[fresh]);assert.equal(bodies.length,1);
  n.configure(profile,{enabled:true,states:[approved]});f.advance();
  await n.process(profile,[{...fresh,id:'disabled-review',at:new Date(f.options.now()).toISOString()}]);assert.equal(bodies.length,1);
  assert.deepEqual(n.status(profile).states,[approved]);
});
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

test('mention-all defaults off for existing configs, persists per project and validates input',async t=>{
  const bodies=[],f=fixture(t,async(target,opts)=>{bodies.push(JSON.parse(opts.body));return Response.json({code:0});});let n=f.make();
  n.configure(profile,{enabled:true,states:STATES,webhook:url});
  const legacy=JSON.parse(fs.readFileSync(f.options.file,'utf8'));delete legacy.one.mentionAll;fs.writeFileSync(f.options.file,JSON.stringify(legacy));n=f.make();
  assert.equal(n.status(profile).mentionAll,false);
  await n.test(profile);assert(!bodies.at(-1).content.text.includes('<at '));
  assert.throws(()=>n.configure(profile,{enabled:true,states:STATES,mentionAll:'true'}),/@全体成员/);
  assert.equal(n.status(profile).mentionAll,false);
  n.configure(profile,{enabled:true,states:STATES,mentionAll:true});n=f.make();
  assert.equal(n.status(profile).mentionAll,true);
  assert.equal(n.status({...profile,id:'two'}).mentionAll,false);
  assert.equal(n.status({...profile,packageName:'com.changed'}).mentionAll,false);
  n.configure(profile,{enabled:true,states:STATES});assert.equal(n.status(profile).mentionAll,true);
  await n.test(profile);assert(bodies.at(-1).content.text.startsWith('<at user_id="all">所有人</at>\n'));
  n.configure(profile,{enabled:true,states:STATES,mentionAll:false});n=f.make();
  await n.test(profile);assert(!bodies.at(-1).content.text.includes('<at '));
});

test('approval and publication mentions are frozen in delivery records and retries',async t=>{
  const bodies=[];let fail=false;
  const f=fixture(t,async(target,opts)=>{bodies.push(JSON.parse(opts.body));if(fail)throw Error('timeout');return Response.json({code:0});});let n=f.make();
  n.configure(profile,{enabled:true,states:STATES,webhook:url,mentionAll:true});f.advance();
  const event={id:'approval',at:new Date(f.options.now()).toISOString(),track:'production',name:'<at user_id="all">injected</at>',versionCodes:['10'],after:STATES[0]};
  await n.process(profile,[event]);
  assert.equal((bodies[0].content.text.match(/<at /g)||[]).length,1);assert.match(bodies[0].content.text,/审核通过/);
  fail=true;await n.process(profile,[{...event,id:'publication',after:STATES[1]}]);
  const original=bodies[1].content.text;assert(original.startsWith('<at user_id="all">所有人</at>\n'));assert.match(original,/已发布/);
  assert.equal(n.status(profile).deliveries[0].status,'uncertain');
  n.configure(profile,{enabled:true,states:STATES,mentionAll:false});n=f.make();fail=false;
  await n.retry(profile,'publication');assert.equal(bodies[2].content.text,original);
  await n.process(profile,[event,{...event,id:'publication',after:STATES[1]}]);assert.equal(bodies.length,3);
  await n.process(profile,[{...event,id:'next-publication',after:STATES[1]}]);assert(!bodies[3].content.text.includes('<at '));
});

test('multiple webhooks fan out independently, sign per target and only retry the failed target',async t=>{
  const second=url.replace('11111111','99999999'),bodies=[];let fail=true;
  const f=fixture(t,async(target,opts)=>{const body=JSON.parse(opts.body);bodies.push({target,body});return Response.json(target===second&&fail?{code:123}:{code:0});});let n=f.make();
  const configured=n.configure(profile,{enabled:true,states:[inReview],targets:[{webhook:url,secret:'first'},{webhook:second,secret:'second'}]});
  assert.equal(configured.targets.length,2);assert(!JSON.stringify(configured).includes(second));assert(!fs.readFileSync(f.options.file,'utf8').includes(second));
  f.advance();const event={id:'multi',at:new Date(f.options.now()).toISOString(),track:'production',name:'v2',versionCodes:['20'],after:inReview};
  await n.process(profile,[event]);assert.equal(bodies.length,2);
  for(const {target,body} of bodies)assert.equal(body.sign,sign(body.timestamp,target===url?'first':'second'));
  const logs=n.status(profile).deliveries;assert.equal(logs.filter(x=>x.status==='sent').length,1);assert.equal(logs.filter(x=>x.status==='failed').length,1);
  n=f.make();await n.process(profile,[event]);assert.equal(bodies.length,2);
  fail=false;await n.retry(profile,logs.find(x=>x.status==='failed').id);assert.equal(bodies.length,3);assert.equal(bodies.at(-1).target,second);
  const saved=n.status(profile);n.configure(profile,{enabled:true,states:[inReview],targets:saved.targets.map(x=>({id:x.id}))});
  await n.test(profile);assert.equal(bodies.length,5);
  assert.throws(()=>n.configure(profile,{enabled:true,states:[inReview],targets:[{webhook:url},{webhook:url}]}),/重复/);
});
test('legacy webhook stays primary after adding targets; removed destinations cannot receive retries',async t=>{
  let calls=0;const f=fixture(t,async()=>{calls++;throw Error('timeout');});
  fs.writeFileSync(f.options.file,JSON.stringify({one:{packageName:profile.packageName,enabled:true,states:[inReview],enabledSince:0,hasSecret:true,sealed:protect(JSON.stringify({webhook:url,secret:'legacy'})),deliveries:[]}}));
  let n=f.make();assert.equal(n.status(profile).targets[0].id,'primary');
  const s=n.configure(profile,{enabled:true,states:[inReview],targets:[{id:'primary'},{webhook:url.replace('11111111','99999999')}]});
  await n.test(profile);assert.equal(calls,2);
  const failed=n.status(profile).deliveries.find(x=>x.targetId!=='primary');
  n.configure(profile,{enabled:true,states:[inReview],targets:[{id:'primary'}]});
  await n.retry(profile,failed.id);assert.equal(calls,2);assert.match(n.status(profile).deliveries.find(x=>x.id===failed.id).error,/已移除/);
  assert.equal(n.status(profile).hasSecret,true);
});

test('multi-target deduplication survives delivery-log trimming',async t=>{
 let calls=0;const f=fixture(t,async()=>{calls++;return Response.json({code:0});});f.options.sleep=async()=>{};const n=f.make();
 n.configure(profile,{enabled:true,states:[inReview],targets:Array.from({length:10},(_,i)=>({webhook:url.replace('11111111',String(i+1).padStart(8,'0'))}))});f.advance();
 const events=Array.from({length:60},(_,i)=>({id:'event-'+i,at:new Date(f.options.now()).toISOString(),track:'production',name:'v'+i,versionCodes:[String(i)],after:inReview}));
 await n.process(profile,events);assert.equal(calls,600);await n.process(profile,events);assert.equal(calls,600);
});

test('disabling notifications during fanout cancels remaining destinations',async t=>{
 let finish,calls=0;const f=fixture(t,async()=>{calls++;if(calls>1)return Response.json({code:0});return new Promise(resolve=>{finish=resolve;});});f.options.sleep=async()=>{};const n=f.make();
 n.configure(profile,{enabled:true,states:[inReview],targets:[{webhook:url},{webhook:url.replace('11111111','99999999')}]});f.advance();
 const pending=n.process(profile,[{id:'pause-event',at:new Date(f.options.now()).toISOString(),track:'production',name:'v1',versionCodes:['1'],after:inReview}]);
 try{n.configure(profile,{enabled:false,states:[inReview]});}finally{finish(Response.json({code:0}));await pending;}
 assert.equal(calls,1);assert.equal(n.status(profile).enabled,false);
});

test("new profiles require explicit opt-in for review notifications",t=>{const f=fixture(t,async()=>Response.json({code:0}));assert.deepEqual(f.make().status(profile).states,STATES.slice(0,2));});

test('unreadable credentials can be replaced without losing identities or delivery history',async t=>{
  const bodies=[],f=fixture(t,async(target,opts)=>{bodies.push({target,body:JSON.parse(opts.body)});return Response.json({code:0});});
  f.options.sleep=async()=>{};let n=f.make();
  n.configure(profile,{enabled:true,states:STATES,targets:[{webhook:url,secret:'old'},{webhook:url.replace('11111111','99999999')}]});
  await n.test(profile);
  const saved=n.status(profile),disk=JSON.parse(fs.readFileSync(f.options.file,'utf8'));
  disk.one.sealed='unreadable';fs.writeFileSync(f.options.file,JSON.stringify(disk));
  f.options.protect=(value,decode)=>{if(decode&&value==='unreadable')throw Error('DPAPI failure');return protect(value,decode);};n=f.make();
  const original=fs.readFileSync(f.options.file,'utf8');
  const save=targets=>n.configure(profile,{enabled:true,states:STATES,targets});
  assert.throws(()=>save(saved.targets.map(x=>({id:x.id}))),/无法解密/);
  assert.throws(()=>save([{id:saved.targets[0].id,webhook:url},{id:saved.targets[1].id,webhook:url.replace('11111111','99999999')}]),/签名密钥/);
  assert.throws(()=>save([{id:saved.targets[0].id,webhook:url,secret:'new'},{id:saved.targets[1].id}]),/Webhook/);
  assert.equal(fs.readFileSync(f.options.file,'utf8'),original);
  assert.deepEqual(n.status(profile),saved);
  const result=save(saved.targets.map((x,i)=>({id:x.id,webhook:i?url.replace('11111111','99999999'):url,secret:i?'':'replacement'})));
  assert.deepEqual(result.targets.map(x=>x.id),saved.targets.map(x=>x.id));assert.deepEqual(result.deliveries,saved.deliveries);
  n=f.make();await n.test(profile);assert.equal(bodies.length,4);
  assert.equal(bodies[2].body.sign,sign(bodies[2].body.timestamp,'replacement'));assert.equal(bodies[3].body.sign,undefined);
});

test('legacy unreadable credentials require replacement or explicit signature clearing',t=>{
  const f=fixture(t,async()=>Response.json({code:0}));
  fs.writeFileSync(f.options.file,JSON.stringify({one:{packageName:profile.packageName,enabled:true,states:STATES,enabledSince:0,hasSecret:true,sealed:'broken',deliveries:[]}}));
  f.options.protect=(value,decode)=>{if(decode&&value==='broken')throw Error('DPAPI failure');return protect(value,decode);};
  const n=f.make();assert.throws(()=>n.configure(profile,{enabled:true,states:STATES,webhook:url}),/签名密钥/);
  n.configure(profile,{enabled:true,states:STATES,webhook:url,clearSecret:true});
  assert.equal(f.make().status(profile).hasSecret,false);
  assert.equal(JSON.parse(protect(JSON.parse(fs.readFileSync(f.options.file,'utf8')).one.sealed,true)).targets[0].webhook,url);
});
