'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
test('support reads work during update, but shortcuts and quit cannot interrupt it',async t=>{
 const data=fs.mkdtempSync(path.join(os.tmpdir(),'gp-support-'));process.env.GP_DATA_DIR=data;process.env.GP_PORT='14351';
 const {server}=require('../server');await new Promise(r=>server.listen(14351,'127.0.0.1',r));
 t.after(async()=>{await new Promise(r=>server.close(r));fs.rmSync(data,{recursive:true,force:true});});
 const base='http://127.0.0.1:14351',session=await(await fetch(base+'/api/session')).json();
 const call=(url,token=session.token)=>fetch(base+'/api/'+url,{method:'POST',headers:{'Content-Type':'application/json','X-GP-Token':token},body:'{}'});
 assert.equal((await call('system/diagnostics','bad')).status,403);
 fs.writeFileSync(path.join(data,'update.lock'),String(process.pid));
 fs.writeFileSync(path.join(data,'update-status.json'),JSON.stringify({phase:'installing',version:'0.2.0'}));
 const status=await call('system/status');assert.equal(status.status,200);assert.equal((await status.json()).update.locked,true);
 const report=await call('system/diagnostics');assert.equal(report.status,200);assert.equal((await report.json()).format,'playbatch-diagnostics-v1');
 assert.equal((await call('system/quit')).status,409);assert.equal((await call('system/shortcuts')).status,409);
 fs.unlinkSync(path.join(data,'update.lock'));
});
