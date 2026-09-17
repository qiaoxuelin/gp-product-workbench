'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createMonitor,stateLabel}=require('../review-monitor');
test('review monitoring separates projects, persists configuration and records real lifecycle changes',async t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'gp-review-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const profiles=[{id:'one',packageName:'com.one'},{id:'two',packageName:'com.two'}];let state='IN_REVIEW',fail=false,time=1000000;
  const file=path.join(dir,'monitor.json'),options={file,profiles:()=>profiles,now:()=>time,listReleases:async(p,track)=>{assert.equal(p.id,'one');assert.equal(track,'production');if(fail)throw Object.assign(Error('Google 403'),{status:403});return {releases:[{releaseName:'1.0',activeArtifacts:[{versionCode:10}],releaseLifecycleState:'RELEASE_LIFECYCLE_STATE_'+state}]};}};
  let monitor=createMonitor(options);assert.equal(monitor.due(),undefined);
  monitor.configure('one',{enabled:true,tracks:['production'],intervalMinutes:5});assert.equal(monitor.due(),'one');
  let result=await monitor.check('one');assert.equal(result.events.length,0);assert.equal(monitor.due(),undefined);
  time+=300001;state='APPROVED_NOT_PUBLISHED';result=await monitor.check('one');assert.equal(result.events.length,1);assert.equal(result.unread,1);assert.equal(stateLabel(result.snapshot[0].state),'通过待发布');
  assert.equal(monitor.status('two').lastCheck,null);
  monitor=createMonitor(options);assert.equal(monitor.status('one').events.length,1);
  fail=true;result=await monitor.check('one');assert.match(result.error,/权限/);assert.equal(result.snapshot[0].state,'RELEASE_LIFECYCLE_STATE_APPROVED_NOT_PUBLISHED');assert.equal(result.events.length,1);
  monitor.acknowledge('one');assert.equal(monitor.status('one').unread,0);
  fail=false;state='PUBLISHED';result=await monitor.check('one');assert.equal(result.events.length,2);assert.equal(stateLabel(result.snapshot[0].state),'已发布');
  profiles[0]={id:'one',packageName:'com.changed'};assert.equal(monitor.status('one').enabled,false);assert.equal(monitor.status('one').snapshot.length,0);
});
test('review monitor treats empty lists as no result and deduplicates concurrent reads',async t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'gp-review-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  let calls=0;const monitor=createMonitor({file:path.join(dir,'data.json'),profiles:()=>[{id:'one',packageName:'com.one'}],listReleases:async()=>{calls++;await new Promise(r=>setTimeout(r,10));return {}; }});
  assert.throws(()=>monitor.configure('one',{enabled:true,tracks:['../unsafe'],intervalMinutes:5}),/轨道/);
  monitor.configure('one',{enabled:true,tracks:['production'],intervalMinutes:5});
  await Promise.all([monitor.check('one'),monitor.check('one')]);assert.equal(calls,1);assert.deepEqual(monitor.status('one').snapshot,[]);assert.equal(monitor.status('one').events.length,0);
});

test('quota 403 backs off persistently without permission advice or manual bypass',async t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'gp-quota-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  let time=1000000,calls=0,fail=false;
  const options={file:path.join(dir,'monitor.json'),profiles:()=>[{id:'one',packageName:'com.one'}],now:()=>time,listReleases:async()=>{calls++;if(fail)throw Object.assign(Error('Google 403：Listing releases quota exceeded.'),{status:403});return {releases:[{releaseName:'v1',releaseLifecycleState:'RELEASE_LIFECYCLE_STATE_IN_REVIEW'}]};}};
  let monitor=createMonitor(options);const config={enabled:true,intervalMinutes:5,tracks:['production']};monitor.configure('one',config);
  const good=await monitor.check('one');fail=true;
  let result=await monitor.check('one');assert.match(result.error,/配额受限/);assert.doesNotMatch(result.error,/补充.*权限/);assert.deepEqual(result.snapshot,good.snapshot);assert.equal(result.lastCheck,good.lastCheck);assert.equal(result.quotaUntil,time+15*60000);
  monitor=createMonitor(options);monitor.configure('one',config);await monitor.check('one');assert.equal(calls,2);assert.equal(monitor.due(),undefined);
  time=result.quotaUntil;assert.equal(monitor.due(),'one');result=await monitor.check('one');assert.equal(calls,3);assert.equal(result.quotaUntil,time+30*60000);
  time=result.quotaUntil;fail=false;result=await monitor.check('one');assert.equal(result.error,'');assert.equal(result.quotaUntil,0);assert.equal(result.quotaFailures,0);
});
