'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {createWorkspaceProjects}=require('../workspace-projects');
function fixture(){const store={'config.json':{keep:'google'},'apple-config.json':{keep:'apple'}},google=[{id:'g1',name:'Same name',packageName:'com.game'},{id:'g2',name:'Other',packageName:'com.other'}],apple=[{id:'a1',name:'Same name',bundleId:'com.game.ios'}];const make=()=>createWorkspaceProjects({read:(k,f)=>structuredClone(store[k]??f),save:(k,v)=>store[k]=structuredClone(v),googleProfiles:()=>google,appleProfiles:()=>apple});return {store,google,apple,make};}
test('legacy platform configurations remain separate until explicitly associated',()=>{
 const f=fixture(),s=f.make();let state=s.snapshot();assert.equal(state.projects.length,3);assert(!f.store['workspace-projects.json']);
 const original=structuredClone(f.store);state=s.update({id:'google:g1',name:'Shared game',googleId:'g1',appleId:'a1',revision:state.revision});
 assert.equal(state.projects.length,2);assert.deepEqual(state.projects.find(p=>p.id==='google:g1'),{id:'google:g1',name:'Shared game',googleId:'g1',appleId:'a1'});
 assert.deepEqual(f.store['config.json'],original['config.json']);assert.deepEqual(f.store['apple-config.json'],original['apple-config.json']);assert.deepEqual(f.make().snapshot(),s.snapshot());
});
test('projects reject stale edits and cross-project stealing, and detaching preserves app access',()=>{
 const f=fixture(),s=f.make();let state=s.snapshot();const stale=state.revision;
 state=s.update({id:'google:g1',name:'Game',googleId:'g1',appleId:'a1',revision:state.revision});
 assert.throws(()=>s.update({id:'google:g2',name:'Other',googleId:'g2',appleId:'a1',revision:stale}),/已变化/);
 assert.throws(()=>s.update({id:'google:g2',name:'Other',googleId:'g2',appleId:'a1',revision:state.revision}),/其他双平台项目/);
 state=s.update({id:'google:g1',name:'Game',googleId:'',appleId:'a1',revision:state.revision});
 assert.equal(new Set(state.projects.map(p=>p.id)).size,state.projects.length);assert(state.projects.some(p=>p.googleId==='g1'&&p.id!=='google:g1'));
 state=s.update({name:'Empty game',googleId:'',appleId:'',revision:state.revision});assert(state.projects.some(p=>p.name==='Empty game'));assert.equal(f.google.length,2);assert.equal(f.apple.length,1);
});
test('invalid associations and storage failures never mutate the saved registry',()=>{
 const f=fixture(),s=f.make();let state=s.snapshot();assert.throws(()=>s.update({name:'Bad',googleId:'missing',revision:state.revision}),/不存在/);assert(!f.store['workspace-projects.json']);
 const broken=createWorkspaceProjects({read:(k,d)=>d,save:()=>{throw Error('disk full');},googleProfiles:()=>f.google,appleProfiles:()=>f.apple});
 assert.throws(()=>broken.update({name:'Game',googleId:'g1',appleId:'a1',revision:broken.snapshot().revision}),/disk full/);assert.equal(broken.snapshot().projects.length,3);
});
