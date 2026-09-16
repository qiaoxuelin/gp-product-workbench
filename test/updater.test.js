'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto'),{EventEmitter}=require('node:events');
const {newer,releaseInfo,createUpdater}=require('../updater');
const bytes=Buffer.from('fixture update bytes');
function metadata(){return {tag_name:'v0.2.0',body:'<script>not rendered</script>',assets:[{name:'PlayBatch-0.2.0-Windows-x64.zip',state:'uploaded',size:bytes.length,digest:'sha256:'+crypto.createHash('sha256').update(bytes).digest('hex'),browser_download_url:'https://github.com/qiaoxuelin/gp-product-workbench/releases/download/v0.2.0/PlayBatch-0.2.0-Windows-x64.zip'}]};}
async function settle(updater){for(let n=0;n<100;n++){if(['failed','installing'].includes(updater.status().phase))return;await new Promise(r=>setTimeout(r,5));}throw Error('Update did not settle');}
function fixture(t,options={}){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'gp-update-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  fs.writeFileSync(path.join(dir,'update-install.ps1'),'fixture');
  return {dir,updater:createUpdater({root:dir,data:dir,version:'0.1.7',port:4318,supported:true,...options})};
}
test('update metadata only accepts official complete stable assets and compares versions numerically',()=>{
  assert.ok(newer('0.10.0','0.9.0'));assert.equal(newer('0.1.7','0.1.7'),false);
  assert.equal(releaseInfo(metadata(),'0.1.7').available,true);
  for(const mutate of [m=>m.prerelease=true,m=>m.assets[0].digest='',m=>m.assets[0].browser_download_url='https://evil.test/payload.zip',m=>m.assets[0].size=999999999]){
    const m=metadata();mutate(m);assert.throws(()=>releaseInfo(m,'0.1.7'));
  }
});
test('update download verifies bytes before launching helper and releases failed helper lock',async t=>{
  let launches=0;const child=new EventEmitter();child.unref=()=>{};
  const {dir,updater}=fixture(t,{fetchImpl:async url=>new Response(url.includes('api.github.com')?JSON.stringify(metadata()):bytes),launch:()=>{launches++;queueMicrotask(()=>child.emit('spawn'));return child;}});
  updater.begin('0.2.0');await settle(updater);await new Promise(r=>setTimeout(r,10));
  assert.equal(launches,1);assert.equal(updater.status().phase,'installing');assert.equal(updater.isActive(),true);
  const job=fs.readdirSync(dir).find(n=>n.startsWith('update-')&&fs.statSync(path.join(dir,n)).isDirectory());
  assert.deepEqual(fs.readFileSync(path.join(dir,job,'release.zip')),bytes);
  child.emit('exit',1);assert.equal(updater.isActive(),false);assert.equal(updater.status().phase,'failed');
});
test('corrupt download and changed release never launch an installer',async t=>{
  for(const expected of ['0.2.0','0.1.9']){
    let launches=0;
    const {updater}=fixture(t,{fetchImpl:async url=>new Response(url.includes('api.github.com')?JSON.stringify(metadata()):Buffer.alloc(bytes.length)),launch:()=>{launches++;throw Error('must not launch');}});
    updater.begin(expected);await settle(updater);
    assert.equal(updater.status().phase,'failed');assert.equal(updater.isActive(),false);assert.equal(launches,0);
  }
});
test('source mode rejects installation and network errors remain actionable',async t=>{
  const {updater}=fixture(t,{supported:false,fetchImpl:async()=>{throw Error('offline');}});
  assert.throws(()=>updater.begin('0.2.0'),/源码版/);await assert.rejects(updater.check(),/无法连接 GitHub/);
});
