'use strict';
window.PlayReporting=(()=>{
 function mount(a){
  const esc=a.esc,$=id=>document.getElementById(id),hour=3600000;
  let reports=[],next='',savedQuery=null,interval=null,fetchedAt='',loading=false;
  const date=d=>d.toISOString().slice(0,16),display=v=>Number.isFinite(Date.parse(v))?new Date(v).toISOString().slice(0,16).replace('T',' ')+' UTC':String(v||'');
  const types={ALL:'崩溃 + ANR',CRASH:'崩溃',ANR:'ANR（无响应）'};
  a.page('崩溃与 ANR 报告',`<div class="pr-workspace" id="prRoot">
   <div class="pr-intro"><div><span class="pr-kicker">ANDROID VITALS</span><p>查看错误现场，定位受影响版本与设备。</p></div><span class="pr-app">${esc(a.packageName)}</span></div>
   <form id="prForm" class="pr-filters">
    <div class="pr-section-title"><h3>查询范围</h3><span>手动读取 · 每页 50 条</span></div>
    <div class="pr-presets" aria-label="快捷时间范围"><button type="button" data-pr-hours="24">最近 24 小时</button><button type="button" data-pr-hours="168">最近 7 天</button><button type="button" data-pr-hours="720">最近 30 天</button><span>UTC 时间 · 北京时间减 8 小时</span></div>
    <div class="pr-grid"><label class="field">起始时间（包含）<input id="prStart" type="datetime-local" step="3600" required></label><label class="field">结束时间（不包含）<input id="prEnd" type="datetime-local" step="3600" required></label><label class="field">错误类型<select id="prType"><option value="ALL">崩溃 + ANR</option><option value="CRASH">崩溃</option><option value="ANR">ANR（无响应）</option></select></label><label class="field">版本号（可选）<input id="prVersion" inputmode="numeric" pattern="[0-9]*" maxlength="19" placeholder="versionCode，例如 123"></label></div>
    <details class="pr-advanced"><summary>高级筛选 · Android 版本 / 问题 ID</summary><div class="pr-grid pr-grid-two"><label class="field">Android API 等级<input id="prApi" inputmode="numeric" pattern="[0-9]*" maxlength="19" placeholder="例如 35"></label><label class="field">问题 ID<input id="prIssue" inputmode="numeric" pattern="[0-9]*" maxlength="19" placeholder="Google errorIssueId"></label></div></details>
    <div class="pr-actions"><button type="submit" id="prSearch" class="primary">查询报告</button><button type="button" id="prReset" class="text-btn">重置筛选</button><span>默认最近 24 个完整小时，单次最多 31 天。</span></div>
   </form>
   <p id="prStatus" class="pr-status" role="status" aria-live="polite">尚未查询；打开页面不会请求 Google。</p>
   <section id="prResults" aria-label="报告查询结果">
    <div class="pr-result-heading"><div><h3>错误报告 <span id="prCount" class="pr-count">—</span></h3><p id="prSummary">选择查询范围后，点击“查询报告”。</p></div><button type="button" id="prExport" disabled>导出已加载报告 JSON</button></div>
    <div id="prStats" class="pr-stats" hidden></div>
    <label class="field pr-local-search" id="prLocalSearch" hidden>搜索已加载报告<input id="prFind" type="search" placeholder="设备、版本、问题 ID 或堆栈关键词（不请求 Google）"></label>
    <p id="prVisible" class="pr-muted" hidden></p><div id="prReports" class="report-list"><div class="pr-empty"><b>准备好排查问题了吗？</b><p>查询后可展开报告，查看完整堆栈与设备信息。</p></div></div>
    <div class="pr-pagination"><button type="button" id="prNext" disabled>加载下一页</button><span id="prPageHint">结果逐页读取，不会自动拉取全部报告。</span></div>
   </section>
   <details class="pr-help"><summary>首次使用与数据说明</summary><p>在服务账号所属 Cloud 项目启用 Google Play Developer Reporting API，并在 Play Console 为该账号授予当前应用的“查看应用信息（只读）”权限。复用当前项目凭据。</p><p>Google 会去重合并报告，报告条数不等于崩溃次数或受影响用户数；空结果也不代表崩溃率为零。事件时间是最近一次事件所在小时。导出仅包含已加载报告。</p><a href="https://developers.google.com/play/developer/reporting/reference/rest/v1beta1/vitals.errors.reports/search" target="_blank" rel="noreferrer">Google 报告接口说明 ↗</a></details>
  </div>`);
  const panel=$('featurePanel');panel.oninput=null;panel.onchange=null;
  const values=()=>({startTime:$('prStart').value+'Z',endTime:$('prEnd').value+'Z',type:$('prType').value,versionCode:$('prVersion').value.trim(),apiLevel:$('prApi').value.trim(),errorIssueId:$('prIssue').value.trim(),pageSize:50});
  const changed=()=>savedQuery&&JSON.stringify(savedQuery)!==JSON.stringify(values());
  function controls(){
   $('prSearch').disabled=loading;$('prSearch').textContent=loading?'正在读取…':'查询报告';$('prNext').disabled=loading||!next||changed()||reports.length>=1000;$('prExport').disabled=loading||!savedQuery;
   $('prRoot').setAttribute('aria-busy',String(loading));
   $('prPageHint').textContent=!savedQuery?'结果逐页读取，不会自动拉取全部报告。':changed()?'筛选已更改，请重新查询后继续翻页。':reports.length>=1000&&next?'已达 1000 条上限，请缩小时间范围查询其余报告。':next?'还有更多报告；导出仅包含已加载内容。':'本次查询已无下一页。';
  }
  function status(text,error=false){$('prStatus').textContent=text;$('prStatus').className='pr-status'+(error?' pr-error':'');a.status(text,error);}
  function download(text,name,type){const url=URL.createObjectURL(new Blob([text],{type})),link=document.createElement('a');link.href=url;link.download=name;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
  function preset(hours){const end=new Date(Math.floor(Date.now()/hour)*hour);$('prEnd').value=date(end);$('prStart').value=date(new Date(end-hours*hour));$('prForm').querySelectorAll('[data-pr-hours]').forEach(b=>b.setAttribute('aria-pressed',String(Number(b.dataset.prHours)===hours)));}
  function filtersChanged(){controls();if(savedQuery)status(changed()?'筛选条件已变更，请点击“查询报告”；下方仍是上次结果。':'筛选条件与下方结果一致，可继续加载。');}
  const deviceName=r=>r.deviceModel?.marketingName||[r.deviceModel?.deviceId?.buildBrand,r.deviceModel?.deviceId?.buildDevice].filter(Boolean).join('/')||'未知设备';
  function renderDetails(card,r,i){
   if(card.querySelector('.pr-detail').hasChildNodes())return;
   const id=r.deviceModel?.deviceId||{};
   card.querySelector('.pr-detail').innerHTML=`<dl class="pr-metadata"><div><dt>报告 ID</dt><dd>${esc(r.name||'未提供')}</dd></div><div><dt>关联问题</dt><dd>${esc(r.issue||'未提供')}</dd></div><div><dt>Android API 等级</dt><dd>${esc(r.osVersion?.apiLevel||'未提供')}</dd></div><div><dt>设备标识</dt><dd>${esc([id.buildBrand,id.buildDevice].filter(Boolean).join('/')||'未提供')}</dd></div></dl><div class="pr-stack-heading"><h4>错误堆栈</h4><div><button type="button" data-report-copy="${i}">复制堆栈</button><button type="button" data-report-download="${i}">下载 TXT</button></div></div><pre class="report-stack" tabindex="0">${esc(r.reportText||'Google 未提供堆栈文本')}</pre>${r.vcsInformation?'<h4>版本控制信息</h4><pre class="report-stack">'+esc(r.vcsInformation)+'</pre>':''}`;
   card.querySelector('[data-report-download]').onclick=()=>download('应用：'+a.packageName+'\n报告：'+(r.name||'')+'\n类型：'+r.type+'\n时间：'+r.eventTime+'\n版本：'+(r.appVersion?.versionCode||'')+'\n设备：'+JSON.stringify(r.deviceModel||{})+'\nAndroid：'+JSON.stringify(r.osVersion||{})+'\n问题：'+(r.issue||'')+'\n\n'+(r.reportText||'')+'\n\n'+(r.vcsInformation||''),a.packageName+'-report-'+(i+1)+'.txt','text/plain;charset=utf-8');
   card.querySelector('[data-report-copy]').onclick=async e=>{try{await navigator.clipboard.writeText(r.reportText||'');e.target.textContent='已复制';status('堆栈已复制。');}catch{status('无法访问剪贴板，请选中堆栈复制，或下载 TXT。',true);}};
  }
  function draw(){
   const opened=new Set([...$('prReports').querySelectorAll('details[open]')].map(c=>c.dataset.reportKey));
   const filter=$('prFind').value.trim().toLowerCase(),visible=reports.map((r,i)=>({r,i})).filter(({r})=>!filter||[r.name,r.issue,r.type,r.appVersion?.versionCode,deviceName(r),r.osVersion?.apiLevel,r.reportText].join(' ').toLowerCase().includes(filter));
   $('prCount').textContent=String(reports.length);$('prSummary').textContent='已加载 '+reports.length+' 条 · '+display(interval.startTime)+' → '+display(interval.endTime)+' · '+types[savedQuery.type]+(savedQuery.versionCode?' · 版本 '+savedQuery.versionCode:'')+(savedQuery.apiLevel?' · API '+savedQuery.apiLevel:'')+(savedQuery.errorIssueId?' · 问题 '+savedQuery.errorIssueId:'');
   $('prStats').hidden=false;$('prStats').innerHTML=[['崩溃报告',reports.filter(r=>r.type==='CRASH').length],['ANR 报告',reports.filter(r=>r.type==='ANR').length],['涉及版本',new Set(reports.map(r=>r.appVersion?.versionCode).filter(Boolean)).size]].map(([label,n])=>'<div><span>'+label+'</span><strong>'+n+'</strong><small>仅统计已加载报告</small></div>').join('');
   $('prLocalSearch').hidden=!reports.length;$('prVisible').hidden=!filter;$('prVisible').textContent='当前显示 '+visible.length+' / '+reports.length+' 条；导出仍包含全部已加载报告。';
   $('prReports').innerHTML=visible.length?visible.map(({r,i})=>{const key=r.name||String(i),snippet=String(r.reportText||'Google 未提供堆栈文本').split('\n').find(s=>s.trim())||'';return `<details class="report-card" data-report-key="${esc(key)}" data-report-index="${i}" ${opened.has(key)?'open':''}><summary><div class="pr-report-top"><span class="pr-type ${r.type==='ANR'?'pr-anr':'pr-crash'}">${esc(types[r.type]||r.type||'未知类型')}</span><span class="pr-version">版本 ${esc(r.appVersion?.versionCode||'未知')}</span><time>${esc(display(r.eventTime)||'时间未知')}</time></div><p class="pr-snippet">${esc(snippet.slice(0,220))}</p><span class="pr-device">${esc(deviceName(r))} · Android API ${esc(r.osVersion?.apiLevel||'未知')}<span class="pr-expand">查看堆栈</span></span></summary><div class="pr-detail"></div></details>`;}).join(''):'<div class="pr-empty"><b>'+(reports.length?'没有匹配的已加载报告':'此范围内未返回报告')+'</b><p>'+(reports.length?'尝试其他关键词，或清空搜索。':'可调整时间、版本或错误类型后重试。空结果不代表没有崩溃或 ANR。')+'</p></div>';
   $('prReports').querySelectorAll('.report-card').forEach(card=>{const i=Number(card.dataset.reportIndex);card.ontoggle=()=>{if(card.open)renderDetails(card,reports[i],i);};if(card.open)renderDetails(card,reports[i],i);});
  }
  async function load(more){
   if(loading)return;if(more&&(!next||changed()||reports.length>=1000))return;
   const q=more?savedQuery:values(),pageToken=more?next:'';
   const start=Date.parse(q.startTime),end=Date.parse(q.endTime);
   if(!Number.isFinite(start)||!Number.isFinite(end)||start>=end||end>Date.now()||end-start>31*24*hour||start%hour||end%hour){status('请选择有效的 UTC 整点范围：起始早于结束，最多 31 天，且结束不能晚于现在。',true);return;}
   loading=true;controls();$('prForm').inert=true;$('prResults').inert=true;status(more?'正在读取下一页，已有报告会保留…':'正在读取 Google 报告…');
   try{const result=await a.job(()=>a.api('reporting/search',{...q,pageToken}),'正在读取错误报告…');if(result.packageName!==a.packageName)throw Error('报告所属应用不匹配，请重新打开页面');if(pageToken&&result.nextPageToken===pageToken)throw Error('Google 返回重复分页标记，请重新查询');
    const seen=new Set(more?reports.map(r=>r.name).filter(Boolean):[]),incoming=result.reports.filter(r=>{if(r.name&&seen.has(r.name))return false;if(r.name)seen.add(r.name);return true;});
    if(!more)$('prFind').value='';reports=more?[...reports,...incoming]:incoming;next=result.nextPageToken;savedQuery={...q};interval=result.interval;fetchedAt=result.fetchedAt;draw();
    status(reports.length?'读取成功，已加载 '+reports.length+' 条报告。':'此范围内未返回报告；不代表崩溃率或 ANR 率为零。');
   }catch(e){status(e.message+(savedQuery?'；下方保留上次成功查询的报告。':''),true);}finally{loading=false;$('prForm').inert=false;$('prResults').inert=false;controls();}
  }
  $('prForm').onsubmit=e=>{e.preventDefault();void load(false);};$('prNext').onclick=()=>load(true);
  $('prForm').oninput=e=>{if(['prStart','prEnd'].includes(e.target.id))$('prForm').querySelectorAll('[data-pr-hours]').forEach(b=>b.setAttribute('aria-pressed','false'));filtersChanged();};$('prForm').onchange=$('prForm').oninput;
  $('prForm').querySelectorAll('[data-pr-hours]').forEach(b=>b.onclick=()=>{preset(Number(b.dataset.prHours));filtersChanged();});
  $('prReset').onclick=()=>{preset(24);$('prType').value='ALL';for(const id of ['prVersion','prApi','prIssue'])$(id).value='';filtersChanged();};
  $('prFind').oninput=()=>{if(savedQuery)draw();};
  $('prExport').onclick=()=>download(JSON.stringify({packageName:a.packageName,query:savedQuery,interval,fetchedAt,loadedCount:reports.length,hasMore:!!next,reports},null,2),a.packageName+'-crash-anr-reports.json','application/json');
  preset(24);controls();
 }
 return {mount};
})();