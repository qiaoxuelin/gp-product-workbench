'use strict';
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const patterns={accessDenied:/access.{0,8}denied|EACCES|EPERM|拒绝访问/i,timeout:/timed? ?out|timeout|超时/i,missingModule:/MODULE_NOT_FOUND|Cannot find module/i,credentialDecrypt:/无法解密|Unprotect|CryptographicException/i,network:/ECONNRESET|ENOTFOUND|fetch failed|网络/i,helperStarted:/Starting installer/,helperExited:/Installer exited/,quota:/quota|rate.?limit|配额/i};
function logSummary(data,name){
 try{
  const file=path.join(data,name),stat=fs.statSync(file),bytes=Buffer.alloc(Math.min(stat.size,65536)),fd=fs.openSync(file,'r');
  try{fs.readSync(fd,bytes,0,bytes.length,Math.max(0,stat.size-bytes.length));}finally{fs.closeSync(fd);}
  const lines=bytes.toString('utf8').split(/\r?\n/),signals={};
  for(const [code,re] of Object.entries(patterns)){const count=lines.filter(line=>re.test(line)).length;if(count)signals[code]=count;}
  return {name,exists:true,bytes:stat.size,modifiedAt:stat.mtime.toISOString(),signals};
 }catch{return {name,exists:false};}
}
function createDiagnostics({data,version,port,update,desktop}){
 const date=value=>typeof value==='string'&&Number.isFinite(Date.parse(value))?new Date(value).toISOString():null;
 const semver=value=>/^\d+\.\d+\.\d+$/.test(value||'')?value:null;
 const state=update();
 return {format:'playbatch-diagnostics-v1',generatedAt:new Date().toISOString(),
  application:{name:'PlayBatch',version:semver(version),platform:process.platform,architecture:process.arch,osRelease:os.release(),node:process.version,port,uptimeSeconds:Math.floor(process.uptime())},
  update:{phase:['idle','checking','downloading','installing','complete','failed'].includes(state.phase)?state.phase:'unknown',targetVersion:semver(state.version),updatedAt:date(state.updatedAt),locked:!!state.locked,errorTypes:Object.entries(patterns).filter(([,re])=>re.test(String(state.message||''))).map(([code])=>code)},
  desktop:{configured:!!desktop.configured,trayRunning:!!desktop.trayRunning},
  files:{configurationPresent:fs.existsSync(path.join(data,'config.json')),activeInstallationPresent:fs.existsSync(path.join(data,'active-install.json'))},
  logs:['server.log','server-error.log','update-helper.log','tray-error.log'].map(name=>logSummary(data,name))};
}
module.exports={createDiagnostics};
