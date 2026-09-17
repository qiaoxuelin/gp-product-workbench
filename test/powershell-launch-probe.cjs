'use strict';
const fs=require('node:fs'),path=require('node:path'),{spawn}=require('node:child_process');
const dir=fs.mkdtempSync(path.join(__dirname,'..','dist','ps-launch-'));
const script=path.join(dir,'probe.ps1');
fs.writeFileSync(script,"param([string]$Result)\n[IO.File]::WriteAllText($Result,'executed')\n");
(async()=>{console.log('PROBE='+dir);for(const detached of [true,false])for(const noninteractive of [false,true])for(const redirected of [false,true]){
 const name=[detached,noninteractive,redirected].join('-'),result=path.join(dir,name+'.result'),log=path.join(dir,name+'.log');
 const fd=redirected?fs.openSync(log,'w'):null;
 const args=['-NoProfile',...(noninteractive?['-NonInteractive']:[]),'-ExecutionPolicy','Bypass','-File',script,'-Result',result];
 const child=spawn('powershell.exe',args,{detached,windowsHide:true,stdio:redirected?['ignore',fd,fd]:'ignore'});
 const exit=await new Promise(resolve=>{child.once('error',e=>resolve(e.message));child.once('exit',(code,signal)=>resolve({code,signal}));});
 if(fd!==null)fs.closeSync(fd);
 console.log(JSON.stringify({detached,noninteractive,redirected,exit,executed:fs.existsSync(result),output:redirected?fs.readFileSync(log,'utf8'):null}));
}})().catch(e=>{console.error(e);process.exitCode=1});
