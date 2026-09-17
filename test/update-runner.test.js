'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),{spawn}=require('node:child_process');
async function run(t,script){
 const data=fs.mkdtempSync(path.join(os.tmpdir(),'gp-runner-'));
 t.after(()=>fs.rmSync(data,{recursive:true,force:true}));
 const file=path.join(data,'install.json');
 fs.writeFileSync(file,JSON.stringify({data,version:'0.2.0'}));
 fs.writeFileSync(path.join(data,'update-status.json'),JSON.stringify({phase:'installing'}));
 fs.writeFileSync(path.join(data,'update-install.ps1'),script);
 const child=spawn(process.execPath,[path.resolve(__dirname,'../update-runner.js'),file],{windowsHide:true,stdio:'ignore'});
 const code=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',resolve)});
 return {code,state:JSON.parse(fs.readFileSync(path.join(data,'update-status.json'),'utf8')),locked:fs.existsSync(path.join(data,'update.lock'))};
}
test('PowerShell exit 0 without an installation result fails and unlocks', {skip:process.platform!=='win32'},async t=>{
 const result=await run(t,'param([string]$JobFile)\nexit 0\n');
 assert.equal(result.code,1);assert.equal(result.state.phase,'failed');assert.match(result.state.message,/退出码 0/);assert.equal(result.locked,false);
});
test('installer failure reason is preserved by the supervisor', {skip:process.platform!=='win32'},async t=>{
 const result=await run(t,`param([string]$JobFile)
$job=Get-Content -LiteralPath $JobFile -Raw | ConvertFrom-Json
[IO.File]::WriteAllText((Join-Path $job.data 'update-status.json'),'{"phase":"failed","message":"specific installer failure"}')
exit 1
`);
 assert.equal(result.code,1);assert.equal(result.state.message,'specific installer failure');
});
