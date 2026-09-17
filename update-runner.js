'use strict';
// A detached Node process survives the old server. PowerShell itself must not
// use DETACHED_PROCESS: Windows PowerShell can exit 0 without running its file.
const fs=require('node:fs'),path=require('node:path'),{spawn}=require('node:child_process');
const jobFile=process.argv[2],job=JSON.parse(fs.readFileSync(jobFile,'utf8'));
const statusFile=path.join(job.data,'update-status.json'),lock=path.join(job.data,'update.lock');
const ready=path.join(path.dirname(jobFile),'runner-ready.json');
function status(){try{return JSON.parse(fs.readFileSync(statusFile,'utf8'))}catch{return {}}}
function fail(message){
  const current=status();
  if(current.phase!=='complete'&&current.phase!=='failed'){
    fs.writeFileSync(statusFile+'.tmp',JSON.stringify({phase:'failed',version:job.version,message,updatedAt:new Date().toISOString()}));
    fs.renameSync(statusFile+'.tmp',statusFile);
  }
  try{fs.unlinkSync(lock)}catch{}
}
fs.writeFileSync(lock,String(process.pid));
fs.writeFileSync(ready,JSON.stringify({pid:process.pid,at:new Date().toISOString()}));
const powershell=path.join(process.env.SystemRoot||'C:\\Windows','System32','WindowsPowerShell','v1.0','powershell.exe');
console.log(new Date().toISOString(),'Starting installer',job.version);
const child=spawn(powershell,['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',path.join(path.dirname(jobFile),'update-install.ps1'),'-JobFile',jobFile],{windowsHide:true,detached:false,stdio:['ignore','inherit','inherit']});
child.once('error',e=>{fail('无法启动更新安装程序：'+e.message+'；详情见 update-helper.log');process.exitCode=1;});
child.once('exit',(code,signal)=>{
  const current=status();
  console.log(new Date().toISOString(),'Installer exited',code,signal||'',current.phase);
  if(!['complete','failed'].includes(current.phase))fail('更新安装程序已退出但未完成安装（退出码 '+code+'）；详情见 update-helper.log');
  process.exitCode=status().phase==='complete'?0:1;
});
