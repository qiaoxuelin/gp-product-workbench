'use strict';
const fs=require('node:fs'),path=require('node:path'),{execFile}=require('node:child_process'),{promisify}=require('node:util');
const exec=promisify(execFile);
function createDesktop({root,data,port}){
 const entry=path.join(data,'desktop-entry.json');
 function refreshEntry(){
  // Do not switch a shortcut to a candidate until installation has committed.
  if(!fs.existsSync(entry)||fs.existsSync(path.join(data,'update.lock')))return;
  const next=JSON.stringify({root,data,port});
  if(fs.readFileSync(entry,'utf8')!==next)fs.writeFileSync(entry,next);
 }
 refreshEntry();
 function status(){
  refreshEntry();
  let trayRunning=false;
  try{const tray=JSON.parse(fs.readFileSync(path.join(data,'tray-status.json'),'utf8'));trayRunning=Date.now()-Date.parse(tray.lastSeen)<20000&&tray.port===port;}catch{}
  return {supported:process.platform==='win32',configured:fs.existsSync(entry),trayRunning};
 }
 async function shortcuts(){
  if(process.platform!=='win32')throw Error('快捷方式仅支持 Windows');
  await exec(path.join(process.env.SystemRoot||'C:\\Windows','System32','WindowsPowerShell','v1.0','powershell.exe'),['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',path.join(root,'create-shortcuts.ps1'),'-AppRoot',root,'-DataPath',data,'-Port',String(port)],{windowsHide:true,timeout:15000});
  return {created:true,...status()};
 }
 return {status,shortcuts};
}
module.exports={createDesktop};
