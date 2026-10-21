'use strict';
window.FinanceSync={async mount({host,api,esc,job,profiles,activeId}){
 const initial=await api('finance-sync/status');if(!host.isConnected)return;
 const c=initial.config,$=id=>host.querySelector('#'+id);
 host.innerHTML='<h3>每月同步产品收入到飞书</h3><p>每月按北京时间指定日期检查上月及遗漏账期，后台运行即可。报告未发布时次日重试；费用、退款计入净额，各币种分开，账户税项单列。</p><div class="form-grid">'+
 '<label class="checkline wide"><input type="checkbox" id="syncEnabled" '+(c.enabled?'checked':'')+'>启用每月自动同步</label>'+
 '<label class="field">授权项目<select id="syncProfile">'+profiles.map(p=>'<option value="'+esc(p.id)+'" '+(p.id===(c.profileId||activeId)?'selected':'')+'>'+esc(p.name)+'</option>').join('')+'</select></label>'+
 '<label class="field">每月几日<input type="number" min="1" max="28" id="syncDay" value="'+esc(c.day)+'"></label>'+
 '<label class="field">起始账期<input type="month" id="syncMonth" value="'+esc(c.startMonth)+'"></label>'+
 '<label class="field wide">目标飞书电子表格<input id="syncUrl" value="'+esc(c.url)+'" placeholder="粘贴飞书电子表格或 Wiki 链接"></label>'+
 '<label class="field wide">产品名称（每行：包名=产品名；未填写时显示已配置项目名或包名）<textarea id="syncNames" rows="4">'+esc(Object.entries(c.productNames||{}).map(([k,v])=>k+'='+v).join('\n'))+'</textarea></label></div>'+
 '<p class="help">将在目标表中维护“Play月度收入”和“PlayBatch账单明细”两页。使用本机当前 Windows 用户已登录的 lark-cli；其他电脑需各自安装并登录。所选项目须配置财务报告桶及有财务读取权限的服务账号。</p>'+
 '<div class="finance-actions"><button id="syncSave">保存同步设置</button><button id="syncCheck">检查飞书连接</button><button id="syncRun" class="primary">立即同步并核验</button></div><div id="syncStatus" role="status"></div>';
 const show=s=>{const names={running:'正在同步',complete:'同步完成',waiting:'等待账单发布',failed:'同步未完成'};$('syncStatus').textContent=(names[s.phase]||'尚未同步')+(s.progress?' · '+s.progress:'')+(s.lastSuccess?' · 上次完成 '+new Date(s.lastSuccess).toLocaleString():'')+(s.rowCount!==undefined?' · '+s.rowCount+' 条明细':'')+(s.missingMonths?.length?' · 尚无报告：'+s.missingMonths.join('、'):'')+(s.error?' · '+s.error:'')+(s.cliAvailable===false?' · 本机尚未安装 lark-cli':'');for(const id of ['syncSave','syncCheck','syncRun'])$(id).disabled=!!s.running;};
 const collect=()=>{const productNames={};for(const line of $('syncNames').value.split(/\r?\n/).filter(x=>x.trim())){const at=line.indexOf('=');if(at<1||!line.slice(at+1).trim())throw Error('产品名称请按“包名=产品名”填写');productNames[line.slice(0,at).trim()]=line.slice(at+1).trim();}return {enabled:$('syncEnabled').checked,profileId:$('syncProfile').value,url:$('syncUrl').value.trim(),startMonth:$('syncMonth').value,day:Number($('syncDay').value),productNames};};
 async function save(){const result=await api('finance-sync/config',collect());show(result);return result;}
 async function poll(){if(!host.isConnected)return;try{const s=await api('finance-sync/status');if(!host.isConnected)return;show(s);if(s.running)setTimeout(poll,2000);}catch(e){if(host.isConnected){$('syncStatus').textContent=e.message;setTimeout(poll,5000);}}}
 const action=(id,fn)=>{$(id).onclick=async()=>{try{await job(fn,'正在处理月度同步设置…');}catch(e){if(host.isConnected)$('syncStatus').textContent=e.message;}};};
 action('syncSave',async()=>{await save();$('syncStatus').textContent='同步设置已保存。';});
 action('syncCheck',async()=>{const result=await api('finance-sync/check',{url:$('syncUrl').value.trim()});$('syncStatus').textContent='已连接：'+result.title+'。';});
 action('syncRun',async()=>{await save();await api('finance-sync/start');void poll();});
 show(initial);if(initial.running)void poll();
}};
