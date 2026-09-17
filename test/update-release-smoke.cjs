'use strict';
// Exercise an unchanged old release through its real browser and updater.
const fs=require('node:fs'),path=require('node:path'),{execFileSync}=require('node:child_process');
const {chromium}=require('@playwright/test');
const root=path.resolve(__dirname,'..'),version=process.argv[2]||'0.1.8',patched=process.argv.includes('--patched');
const work=fs.mkdtempSync(path.join(root,'dist','update-real-'));
const original=path.join(work,'旧版 original'),data=path.join(work,'用户 data'),port=14349;
const env=Object.fromEntries(Object.entries(process.env).filter(([key],i,all)=>all.findIndex(([other])=>other.toLowerCase()===key.toLowerCase())===i));
Object.assign(env,{GP_DATA_DIR:data,GP_PORT:String(port),GP_NO_BROWSER:'1',GP_NO_TRAY:'1'});
const localTarget=process.argv.find(arg=>arg.startsWith('--local-target='))?.split('=')[1];
if(localTarget){
 const crypto=require('node:crypto'),zip=path.join(root,'dist',`PlayBatch-${localTarget}-Windows-x64.zip`),bytes=fs.readFileSync(zip);
 const url=`https://github.com/qiaoxuelin/gp-product-workbench/releases/download/v${localTarget}/PlayBatch-${localTarget}-Windows-x64.zip`;
 const metadata={tag_name:'v'+localTarget,assets:[{name:`PlayBatch-${localTarget}-Windows-x64.zip`,state:'uploaded',browser_download_url:url,size:bytes.length,digest:'sha256:'+crypto.createHash('sha256').update(bytes).digest('hex')}]};
 const preload=path.join(work,'local-release-transport.cjs');
 fs.writeFileSync(preload,`const fs=require('node:fs'),original=global.fetch;global.fetch=async(url,...args)=>String(url)==='https://api.github.com/repos/qiaoxuelin/gp-product-workbench/releases/latest'?Response.json(${JSON.stringify(metadata)}):String(url)===${JSON.stringify(url)}?new Response(fs.readFileSync(${JSON.stringify(zip)})):original(url,...args);`);
 env.NODE_OPTIONS='--require="'+preload.replaceAll('\\','/')+'"';
 console.log('TRANSPORT=local release metadata and ZIP; installed files remain unchanged');
}
const q=s=>"'"+s.replaceAll("'","''")+"'";
function ps(script){const log=path.join(work,'driver-'+Date.now()+'.log'),fd=fs.openSync(log,'w');try{execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-EncodedCommand',Buffer.from("$ProgressPreference='SilentlyContinue';"+script,'utf16le').toString('base64')],{env,windowsHide:true,stdio:['ignore',fd,fd],timeout:90000});return 'Driver completed; log='+log;}finally{fs.closeSync(fd);}}
function read(file){try{return fs.readFileSync(path.join(data,file),'utf8')}catch{return ''}}
(async()=>{
 console.log('ARTIFACTS='+work);
 fs.mkdirSync(data,{recursive:true});
 console.log(ps(`$ErrorActionPreference='Stop'; Expand-Archive -LiteralPath ${q(path.join(root,'dist',`PlayBatch-${version}-Windows-x64.zip`))} -DestinationPath ${q(original)}`));
 if(patched)for(const file of ['updater.js','update-runner.js'])fs.copyFileSync(path.join(root,file),path.join(original,file));
 console.log(ps(`$ErrorActionPreference='Stop'; & ${q(path.join(original,'start.ps1'))}`));
 const browser=await chromium.launch({channel:'msedge',headless:true});
 const page=await browser.newPage();
 const responses=[];let targetVersion;
 page.on('response',async r=>{if(r.url().includes('/api/update/')||r.url().endsWith('/api/session')){try{const b=await r.json();if(r.url().endsWith('/api/update/check'))targetVersion=b.version;delete b.token;delete b.notes;responses.push({at:new Date().toISOString(),url:r.url(),status:r.status(),body:b});}catch{}}});
 try{
  await page.goto(`http://127.0.0.1:${port}`);
  await page.waitForFunction(v=>document.querySelector('#appVersion')?.textContent===`PlayBatch v${v}`,version);
  if(process.argv.includes('--launch-only')){
   if(!fs.existsSync(path.join(original,'update-runner.js')))throw Error('Packaged update runner is missing');
   console.log('PASS: extracted package runs version '+version+' and includes update runner');
   await page.screenshot({path:path.join(work,'result.png')});return;
  }
  await page.locator('#update').click();
  await page.getByRole('button',{name:'更新并重启',exact:true}).click({timeout:45000});
  let previous='',done=false;
  for(let i=0;i<180;i++){
   await new Promise(r=>setTimeout(r,1000));
   const raw=read('update-status.json');let state;try{state=JSON.parse(raw)}catch{state={}}
   const key=state.phase+':'+state.message;
   if(key!==previous||i%15===0){console.log(JSON.stringify({second:i+1,...state,lock:read('update.lock'),pid:read('server.pid').trim()}));previous=key;}
   if(state.phase==='failed'){done=true;break;}
   if(state.phase==='complete'&&!read('update.lock')){await page.waitForFunction(v=>document.querySelector('#appVersion')?.textContent===`PlayBatch v${v}`,targetVersion,{timeout:15000});done=true;console.log('PASS: real browser reloaded into '+targetVersion);break;}
  }
  await page.screenshot({path:path.join(work,'result.png')});
  console.log('FINAL='+JSON.stringify({done,title:await page.locator('#dialogTitle').textContent(),app:await page.locator('#appVersion').textContent(),state:read('update-status.json')}));
  if(!done)console.log(ps(`Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like ${q('*'+work+'*')} } | Select-Object ProcessId,ParentProcessId,Name,CommandLine | ConvertTo-Json -Depth 3`));
  if(!done||JSON.parse(read('update-status.json')).phase!=='complete')throw Error('Update did not complete; see captured artifacts');
 }finally{
  fs.writeFileSync(path.join(work,'responses.json'),JSON.stringify(responses,null,2));
  await browser.close();
  console.log(ps(`& ${q(path.join(original,'stop.ps1'))}`));
 }
})().catch(e=>{console.error(e);process.exitCode=1});
