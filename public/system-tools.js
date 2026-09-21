'use strict';
window.SystemTools={create(adapter){
 const $=id=>document.getElementById(id),esc=adapter.esc,api=adapter.api,modal=adapter.modal,close=adapter.close,status=adapter.status,job=adapter.job,download=adapter.download;
async function exportDiagnostics(){
  const report=await api('system/diagnostics');
  download('PlayBatch-diagnostics-'+new Date().toISOString().replace(/[:.]/g,'-')+'.json',JSON.stringify(report,null,2),'application/json');
  status('诊断信息已导出，可将文件发送给维护者');
}
function updateSummary(state,version){
  if(state.phase==='complete'&&state.version===version&&!state.locked)return '已更新到 '+version+'，当前运行正常。';
  if(state.phase==='failed')return '上次更新未完成。当前运行版本：'+version+'。'+(state.message||'可导出诊断信息排查。');
  if(['checking','downloading','installing'].includes(state.phase))return '正在更新到 '+(state.version||'新版本')+'，当前运行版本：'+version+'。';
  return '当前运行版本：'+version+'。';
}
async function supportDialog(){
  const info=await api('system/status');
  modal('帮助与诊断','<p><b>PlayBatch v'+esc(info.version)+'</b> · '+(info.desktop.trayRunning?'托盘正在运行':'托盘未运行，可通过“启动工具”重新打开')+'</p><p>'+esc(updateSummary(info.update,info.version))+'</p>'+
    '<h3>体验演示</h3><p>在独立工作区试用 Google Play 商品编辑，不关联真实项目，不写入商店。</p>'+
    '<h3>快捷入口</h3><p>在桌面和开始菜单创建 PlayBatch 快捷方式。更新后仍可从同一个入口打开。</p>'+
    '<h3>诊断信息</h3><p>导出版本、运行状态、更新阶段和日志中的错误类型，便于排查。文件不包含私钥、令牌、项目内容或原始日志。</p>',[
    {label:'关闭',run:close},{label:'体验演示',run:adapter.demo},...(info.desktop.supported?[{label:'创建/修复快捷方式',run:async()=>{await api('system/shortcuts');status('桌面和开始菜单快捷方式已创建');close();}}]:[]),
    {label:'导出诊断信息',class:'primary',run:exportDiagnostics}]);
}
async function showUpdateOutcome(version){
  const info=await api('system/status'),state=info.update;
  if(!['complete','failed'].includes(state.phase))return;
  if(state.phase==='complete'&&(state.locked||state.version!==version))return;
  const stamp=JSON.stringify([state.phase,state.version,state.updatedAt]);
  if(localStorage.getItem('gp-update-notice-v1')===stamp)return;
  $('updateNotice').hidden=false;$('updateNoticeText').textContent=updateSummary(state,version);
  $('dismissUpdateNotice').onclick=()=>{localStorage.setItem('gp-update-notice-v1',stamp);$('updateNotice').hidden=true;};
}
async function updateDialog(){
  modal('检查更新','<p>正在读取 GitHub 最新正式版本…</p>',[{label:'关闭',run:close}]);
  let release;
  try{release=await job(()=>api('update/check'),'正在检查更新…');}
  catch(e){
    const message=e.message==='未知接口'?'当前后台服务仍为旧版。请先双击“停止工具.cmd”，再双击“启动工具.cmd”，刷新页面后重试。':e.message;
    modal('检查更新未完成','<p class="error-box">'+esc(message)+'</p><p><a href="https://github.com/qiaoxuelin/gp-product-workbench/releases/latest" target="_blank" rel="noreferrer">手动下载（GitHub）↗</a></p>',[{label:'关闭',run:close},{label:'重试',run:updateDialog}]);return;
  }
  modal('检查更新','<p>当前版本：<b>'+esc(release.currentVersion)+'</b>　最新版本：<b>'+esc(release.version)+'</b></p>'+
    '<p>'+(release.available?'发现新版本。':'当前已是最新版本，或正在使用更高版本。')+'</p>'+
    (release.supported?'<p>检查后可直接下载、校验、安装并重启，无需另开 GitHub。项目、授权和已保存草稿保留，原启动入口仍可用。源码启动时会安装独立发布版并切换，源码文件保留。</p>':'<p class="warning">此运行环境不支持自动安装。请前往下载页获取 Windows 免安装包。</p>')+
    '<p><a href="'+esc(release.page)+'" target="_blank" rel="noreferrer">手动下载（GitHub）↗</a></p><details><summary>更新说明</summary><pre style="white-space:pre-wrap;overflow-wrap:anywhere">'+esc(release.notes)+'</pre></details>',
    [{label:'关闭',run:close},...(release.available&&release.supported?[{label:'更新并重启',class:'primary',run:()=>installUpdate(release.version)}]:[])]);
}
async function installUpdate(version){
  // Abort if draft persistence fails; do not silently restart with unsaved browser data.
  if(adapter.persist()===false)throw Error('草稿未能保存，请先导出备份');
  await job(()=>api('update/start',{version}),'正在启动更新…');
  modal('正在更新','<p id="updateProgress" role="status">正在准备下载，请保持页面打开…</p>',[]);
  adapter.setWorking(true);document.querySelectorAll('button').forEach(b=>b.disabled=true);if($('mode'))$('mode').disabled=true;$('project').disabled=true;
  const started=Date.now();
  const poll=async()=>{
    try{
      const state=await api('update/status');
      if(state.phase==='complete'&&!state.locked&&state.currentVersion===version){
        location.reload();return;
      }
      if(state.phase==='failed'){
        adapter.setWorking(false);document.querySelectorAll('button').forEach(b=>b.disabled=false);if($('mode'))$('mode').disabled=false;$('project').disabled=false;adapter.render();
        modal('更新未完成','<p class="error-box">'+esc(state.message)+'</p><p>当前版本：'+esc(state.currentVersion||'待确认')+'。可导出诊断信息排查；若服务未启动，请双击原来的“启动工具.cmd”。</p><a href="https://github.com/qiaoxuelin/gp-product-workbench/releases/latest" target="_blank" rel="noreferrer">手动下载（GitHub）↗</a>',[{label:'关闭',run:close},{label:'导出诊断信息',run:exportDiagnostics},{label:'重新检查',run:updateDialog}]);return;
      }
      $('updateProgress').textContent=state.phase==='downloading'?'正在下载：'+Math.floor((state.received||0)/state.total*100)+'%':state.phase==='checking'?'正在核对最新版本…':state.phase==='installing'?'正在安装 '+version+' 并重启，请稍候…':'正在确认 '+version+' 的运行状态…';
    }catch{$('updateProgress').textContent='正在等待工具重启…';}
    if(Date.now()-started>10*60*1000){
      adapter.setWorking(false);document.querySelectorAll('button').forEach(b=>b.disabled=false);if($('mode'))$('mode').disabled=false;$('project').disabled=false;adapter.render();
      modal('更新状态待确认','<p>等待重启超时。可先重新读取运行状态或导出诊断信息。若服务无法连接，请双击原来的“启动工具.cmd”再刷新页面。</p>',[{label:'关闭',run:close},{label:'导出诊断信息',run:exportDiagnostics},{label:'查看运行状态',run:supportDialog}]);return;
    }
    setTimeout(poll,1200);
  };
  setTimeout(poll,500);
}

 return {supportDialog,updateDialog,showUpdateOutcome};
}};
