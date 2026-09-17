'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {createDiagnostics}=require('../diagnostics'),{createDesktop}=require('../desktop-integration');
test('diagnostics never copy credentials, config, paths, update messages or raw log lines',t=>{
 const data=fs.mkdtempSync(path.join(os.tmpdir(),'gp-diagnostics-'));t.after(()=>fs.rmSync(data,{recursive:true,force:true}));
 const secret='DO_NOT_EXPORT_PRIVATE_PAYLOAD';
 fs.writeFileSync(path.join(data,'config.json'),JSON.stringify({name:secret,private_key:secret}));
 fs.writeFileSync(path.join(data,'credential-test.dpapi'),secret);
 fs.writeFileSync(path.join(data,'server-error.log'),'EACCES '+secret+' Authorization: Bearer '+secret+'\n');
 const report=createDiagnostics({data,version:'0.1.16',port:4318,update:()=>({phase:'failed',message:'access denied '+secret,version:secret,updatedAt:secret,locked:true}),desktop:{configured:true,trayRunning:false}});
 const text=JSON.stringify(report);assert(!text.includes(secret));assert(!text.includes(data));assert(!text.includes('private_key'));assert.equal(report.update.targetVersion,null);assert.deepEqual(report.update.errorTypes,['accessDenied']);assert.equal(report.logs.find(l=>l.name==='server-error.log').signals.accessDenied,1);
});
test('shortcut entry follows actual running installation after an upgrade',t=>{
 const data=fs.mkdtempSync(path.join(os.tmpdir(),'gp-desktop-'));t.after(()=>fs.rmSync(data,{recursive:true,force:true}));
 fs.writeFileSync(path.join(data,'desktop-entry.json'),JSON.stringify({root:'old',data,port:4318}));
 createDesktop({root:'new-install',data,port:4319});
 assert.deepEqual(JSON.parse(fs.readFileSync(path.join(data,'desktop-entry.json'))),{root:'new-install',data,port:4319});
 fs.writeFileSync(path.join(data,'update.lock'),'123');
 const candidate=createDesktop({root:'candidate',data,port:4319});candidate.status();
 assert.equal(JSON.parse(fs.readFileSync(path.join(data,'desktop-entry.json'))).root,'new-install');
 fs.unlinkSync(path.join(data,'update.lock'));candidate.status();
 assert.equal(JSON.parse(fs.readFileSync(path.join(data,'desktop-entry.json'))).root,'candidate');
});
