'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),{spawn}=require('node:child_process');
const REPO='qiaoxuelin/gp-product-workbench',PAGE='https://github.com/'+REPO+'/releases/latest';
const MAX=120*1024*1024;
function newer(a,b){if(!/^\d+\.\d+\.\d+$/.test(a)||!/^\d+\.\d+\.\d+$/.test(b))throw Error('版本格式无效');const x=a.split('.').map(Number),y=b.split('.').map(Number);for(let i=0;i<3;i++)if(x[i]!==y[i])return x[i]>y[i];return false;}
function releaseInfo(value,current){
  const version=String(value.tag_name||'').replace(/^v/,'');
  if(value.draft||value.prerelease||!/^\d+\.\d+\.\d+$/.test(version))throw Error('GitHub 未返回可用的正式版本');
  const name='PlayBatch-'+version+'-Windows-x64.zip',asset=value.assets?.find(a=>a.name===name&&a.state==='uploaded');
  const url='https://github.com/'+REPO+'/releases/download/v'+version+'/'+name;
  if(!asset||asset.browser_download_url!==url||!/^sha256:[a-f0-9]{64}$/.test(asset.digest||'')||!Number.isSafeInteger(asset.size)||asset.size<1||asset.size>MAX)throw Error('新版下载包或 SHA256 校验信息不完整，请前往 GitHub 下载页');
  return {version,available:newer(version,current),url,size:asset.size,sha256:asset.digest.slice(7),notes:String(value.body||'').slice(0,30000),page:'https://github.com/'+REPO+'/releases/tag/v'+version};
}
function createUpdater({root,data,version,port,pid=process.pid,fetchImpl=fetch,launch=spawn,supported=process.platform==='win32'&&fs.existsSync(path.join(root,'runtime','node.exe'))&&!fs.existsSync(path.join(root,'.git'))}){
  const statusFile=path.join(data,'update-status.json');let active=false;
  function status(){let s={phase:'idle'};try{s=JSON.parse(fs.readFileSync(statusFile,'utf8'));}catch{}return {...s,currentVersion:version,supported,page:PAGE,locked:fs.existsSync(path.join(data,'update.lock'))};}
  function save(s){fs.mkdirSync(data,{recursive:true});fs.writeFileSync(statusFile+'.tmp',JSON.stringify({...s,updatedAt:new Date().toISOString()}));fs.renameSync(statusFile+'.tmp',statusFile);}
  // Recover an interrupted task only when its recorded owner no longer exists.
  const lockPath=path.join(data,'update.lock');
  if(fs.existsSync(lockPath)){
    const owner=Number(fs.readFileSync(lockPath,'utf8'));
    if(Number.isSafeInteger(owner)&&owner>0){
      try{process.kill(owner,0);}catch(e){if(e.code==='ESRCH'){fs.unlinkSync(lockPath);save({phase:'failed',message:'上次更新意外中断，旧版已保留，可以重新检查更新'});}}
    }
  }else if(['checking','downloading','installing'].includes(status().phase)){
    save({phase:'failed',message:'上次更新未完成，可以重新检查更新'});
  }
  async function check(){
    let response;try{response=await fetchImpl('https://api.github.com/repos/'+REPO+'/releases/latest',{headers:{Accept:'application/vnd.github+json','User-Agent':'PlayBatch/'+version},signal:AbortSignal.timeout(30000)});}catch{throw Error('无法连接 GitHub，请检查网络后重试，也可前往下载页手动更新');}
    if(!response.ok)throw Error(response.status===403||response.status===429?'GitHub 请求受限，请稍后重试或前往下载页':'读取 GitHub 版本失败：'+response.status);
    return {...releaseInfo(await response.json(),version),currentVersion:version,supported};
  }
  async function download(info,job){
    const response=await fetchImpl(info.url,{signal:AbortSignal.timeout(300000)});
    if(!response.ok||!response.body)throw Error('下载更新包失败：'+response.status);
    const zip=path.join(job,'release.zip'),fd=fs.openSync(zip,'wx'),hash=crypto.createHash('sha256');let size=0,last=0;
    try{for await(const chunk of response.body){size+=chunk.length;if(size>info.size||size>MAX)throw Error('更新包大小与发布信息不一致');fs.writeSync(fd,chunk);hash.update(chunk);if(Date.now()-last>500){save({phase:'downloading',version:info.version,received:size,total:info.size});last=Date.now();}}}finally{fs.closeSync(fd);}
    if(size!==info.size||hash.digest('hex')!==info.sha256)throw Error('更新包完整性校验失败，未切换版本，请重试');
    return zip;
  }
  async function run(expected){
    let lockFd;
    const lock=path.join(data,'update.lock');
    try{
      lockFd=fs.openSync(lock,'wx');fs.writeSync(lockFd,String(pid));
      const info=await check();if(!info.available||info.version!==expected)throw Error('最新版本已变化，请重新检查更新');
      const job=fs.mkdtempSync(path.join(data,'update-'));
      save({phase:'downloading',version:info.version,received:0,total:info.size});
      const zip=await download(info,job);
      const install=path.join(job,'install.json');
      fs.writeFileSync(install,JSON.stringify({root:fs.realpathSync(root),data:fs.realpathSync(data),port,pid,version:info.version,zip,sha256:info.sha256}));
      fs.copyFileSync(path.join(root,'update-install.ps1'),path.join(job,'update-install.ps1'));
      save({phase:'installing',version:info.version,message:'安装并重启中，请保持页面打开'});
      const child=launch('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',path.join(job,'update-install.ps1'),'-JobFile',install],{detached:true,windowsHide:true,stdio:'ignore',env:{...process.env,GP_DATA_DIR:data,GP_PORT:String(port),GP_NO_BROWSER:'1'}});
      await new Promise((resolve,reject)=>{child.once('error',reject);child.once('spawn',resolve);});child.once('exit',code=>{if(code!==0&&active){save({phase:'failed',message:'更新助手未正常完成，请重启工具后重试'});active=false;try{fs.unlinkSync(lock);}catch{}}});child.unref();
      // The helper owns the lock until success/rollback. Keep this server read-only until it stops.
      fs.closeSync(lockFd);lockFd=undefined;
    }catch(e){if(lockFd!==undefined){fs.closeSync(lockFd);try{fs.unlinkSync(lock);}catch{}}save({phase:'failed',message:e.code==='EEXIST'?'已有更新任务。请等待完成；若上次被意外中断，请重启工具后重试。':e.message});active=false;}
  }
  function begin(expected){
    if(!supported)throw Error('自动更新仅适用于 Windows 免安装版；源码版请通过 Git 更新或下载免安装包');
    if(active)throw Error('更新正在进行');
    if(!/^\d+\.\d+\.\d+$/.test(expected||''))throw Error('请先检查更新');
    active=true;save({phase:'checking',version:expected});void run(expected);return {started:true};
  }
  // A lock belongs to either the server or the helper; do not silently delete an unknown live task.
  return {check,begin,status,isActive:()=>{if(active&&status().phase==='failed')active=false;return active||fs.existsSync(lockPath)}};
}
module.exports={createUpdater,newer,releaseInfo};
