'use strict';
const $=id=>document.getElementById(id),esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const clone=structuredClone;
let workspace=null;
let token='',settings={profiles:[],current:{}},base=[],draft=[],selected=new Set(),working=false;
const editable=p=>({productId:p.productId,name:p.name,inAppPurchaseType:p.inAppPurchaseType,reviewNote:p.reviewNote||'',localizations:(p.localizations||[]).map(({locale,name,description})=>({locale,name,description:description||''})).sort((a,b)=>a.locale.localeCompare(b.locale))});
const sameDraft=(a,b)=>JSON.stringify([editable(a),a.initialPrice?[a.initialPrice.territory,a.initialPrice.currency,a.initialPrice.price]:null])===JSON.stringify([editable(b),b.initialPrice?[b.initialPrice.territory,b.initialPrice.currency,b.initialPrice.price]:null]);
const old=id=>base.find(p=>p.productId===id)||null,key=()=>'apple-workspace-v1:'+settings.activeId+':'+settings.current.appId;
const dirty=p=>!old(p.productId)||JSON.stringify(editable(p))!==JSON.stringify(editable(old(p.productId)))||Boolean(p.initialPrice);
const resultLabel=s=>({verified:'已核对一致',pending:'待核对',uncertain:'可能部分写入',failed:'未完成'}[s]||s);
const stepLabel=s=>s.startsWith('locale:')?'文案 '+s.slice(7):({create:'创建商品',version:'创建文案版本',configuration:'更新参考信息',price:'设置初始价格'}[s]||s);
const typeLabel=t=>t==='CONSUMABLE'?'消耗型':'非消耗型';
function status(s,error=false){$('status').textContent=s;$('status').className=error?'error':'';}
function fail(e){status(e.message,true);if($('modal').open){let box=$('dialogError');if(!box){box=document.createElement('p');box.id='dialogError';box.className='error-box';box.setAttribute('role','alert');$('dialogBody').append(box);}box.textContent=e.message;}}
async function api(path,body={}){
 const payload=JSON.stringify({platform:'apple',profileId:settings.activeId,appId:settings.current.appId,...body});
 for(let i=0;i<2;i++){
  const r=await fetch('/api/apple/'+path,{method:'POST',headers:{'Content-Type':'application/json','X-GP-Token':token},body:payload}),data=await r.json();
  if(r.status===403&&data.error==='请从本机工具页面操作'&&i===0){const s=await(await fetch('/api/session')).json();if(s.application!=='gp-product-workbench')throw Error('会话无效');token=s.token;continue;}
  if(!r.ok)throw Error(data.error||'请求失败');return data;
 }
}
function bind(id,fn){$(id).onclick=()=>run(fn);}
async function run(fn){if(working)return;try{await fn();}catch(e){fail(e);}}
async function job(fn){working=true;document.querySelectorAll('button,select').forEach(x=>x.disabled=true);status('正在处理…');try{return await fn();}finally{working=false;document.querySelectorAll('button,select').forEach(x=>x.disabled=false);render();}}
function modal(title,html,actions){$('dialogTitle').textContent=title;$('dialogBody').innerHTML=html;$('dialogActions').replaceChildren();for(const a of actions){const b=document.createElement('button');b.textContent=a.label;b.className=a.class||'';b.onclick=()=>run(a.run);$('dialogActions').append(b);}if(!$('modal').open)$('modal').showModal();}
function close(){if(!working)$('modal').close();}
function persist(){if(!settings.activeId)return;localStorage.setItem(key(),JSON.stringify({base,draft}));}
function restore(){selected.clear();let s=null;try{s=JSON.parse(localStorage.getItem(key())||'null');}catch{}base=s?.base||[];draft=s?.draft||[];render();}
function visible(){const q=$('search').value.toLowerCase();return draft.filter(p=>(p.productId+' '+p.name).toLowerCase().includes(q));}
function render(){
 $('project').innerHTML=settings.profiles.length?settings.profiles.map(p=>'<option value="'+esc(p.id)+'">'+esc(p.name)+'</option>').join(''):'<option value="">尚未配置苹果项目</option>';$('project').value=settings.activeId||'';
 $('connectionHint').textContent=settings.current.hasCredential?'API 授权已保存':'尚未导入 API 私钥，可先编辑本地草稿';
 $('selectionHint').textContent=selected.size?'仅预览所选商品中的更改':'预览全部未提交的更改';
 $('appIdentity').textContent=settings.current.appId?settings.current.bundleId+' · '+settings.current.appId:'';
 $('total').textContent=draft.length;$('selectedCount').textContent=selected.size;$('dirtyCount').textContent=draft.filter(dirty).length;
 for(const id of ['refresh','import','create','preview','export'])$(id).disabled=working||!settings.activeId;
 $('preview').disabled=working||!draft.some(p=>dirty(p)&&(!selected.size||selected.has(p.productId)));
 $('copy').disabled=working||selected.size!==1;$('discard').disabled=working||!selected.size;$('project').disabled=working;
 $('products').innerHTML=visible().map(p=>{const b=old(p.productId);return '<tr><td><input type="checkbox" data-select="'+esc(p.productId)+'" aria-label="选择 '+esc(p.productId)+'" '+(selected.has(p.productId)?'checked':'')+'></td><td><strong>'+esc(p.name)+'</strong><small>'+esc(p.productId)+'</small></td><td>'+typeLabel(p.inAppPurchaseType)+'</td><td>'+p.localizations.length+' 种语言<small>'+(p.initialPrice?'待设置 '+esc(p.initialPrice.territory+' '+p.initialPrice.currency+' '+p.initialPrice.price):b?.priceSchedule?'已有价格计划':b?'未读取到价格计划':'未设置初始价格')+'</small></td><td><span class="pill">'+esc(b?.state||'本地新建')+'</span><small>'+esc(b?.version?.state||'')+'</small></td><td>'+(dirty(p)?'<span class="pill orange">待'+(b?'更新':'创建')+'</span>':'无修改')+'</td><td><button data-edit="'+esc(p.productId)+'">编辑</button></td></tr>';}).join('');
 $('empty').hidden=visible().length>0;$('empty').innerHTML=draft.length?'<h2>没有匹配的商品</h2><p>试试其他商品 ID 或名称。</p>':'<h2>还没有读取或创建商品</h2><p>读取 App Store Connect 的商品，或新建草稿、导入 CSV。</p>';
 document.querySelectorAll('[data-select]').forEach(x=>x.onchange=()=>{x.checked?selected.add(x.dataset.select):selected.delete(x.dataset.select);render();});
 document.querySelectorAll('[data-edit]').forEach(x=>x.onclick=()=>run(()=>edit(clone(draft.find(p=>p.productId===x.dataset.edit)))));
 const list=visible();$('selectAll').checked=Boolean(list.length)&&list.every(p=>selected.has(p.productId));$('selectAll').indeterminate=list.some(p=>selected.has(p.productId))&&!$('selectAll').checked;
 $('consoleLink').href='https://appstoreconnect.apple.com/apps'+(settings.current.appId?'/'+encodeURIComponent(settings.current.appId)+'/distribution/iaps':'');
}
function replace(products){for(const p of products){const i=draft.findIndex(x=>x.productId===p.productId);if(i<0)draft.push(p);else draft[i]=p;}persist();render();}
function openSettings(isNew=false){
 const p=isNew?{}:settings.current;
 modal('App Store 应用与授权','<p>使用 App Store Connect 的团队 API Key。应用 Apple ID 是数字，Bundle ID 用于连接时交叉核对。</p><div class="form-grid">'+[
 ['profileName','应用配置名称',p.name],['profileApp','App Apple ID',p.appId],['profileBundle','Bundle ID',p.bundleId],['profileKey','Key ID',p.keyId],['profileIssuer','Issuer ID',p.issuerId]
 ].map(([id,label,value])=>'<label class="field">'+label+'<input id="'+id+'" value="'+esc(value)+'" '+(p.id&&['profileApp','profileBundle'].includes(id)?'readonly':'')+'></label>').join('')+'<label class="field wide">API 私钥（.p8）<input id="privateKey" type="file" accept=".p8"></label></div><p class="help">'+(p.hasCredential?'私钥已加密保存；不选新文件则保留。':'可先保存项目并编辑草稿；读取和上传前需导入 .p8。')+'</p><p><a href="https://developer.apple.com/documentation/appstoreconnectapi/creating-api-keys-for-app-store-connect-api" target="_blank" rel="noreferrer">苹果 API Key 配置说明 ↗</a></p>',[{label:'取消',run:close},{label:'保存 App Store 设置',class:'primary',run:async()=>{
  const f=$('privateKey').files[0];if(f?.size>65536)throw Error('.p8 文件超过 64KB');const body={id:p.id||'',name:$('profileName').value,appId:$('profileApp').value.trim(),bundleId:$('profileBundle').value.trim(),keyId:$('profileKey').value.trim(),issuerId:$('profileIssuer').value.trim(),privateKey:f?await f.text():''};persist();settings=await job(()=>api('config/save',body));restore();close();if(workspace)await workspace.profileSaved(settings.activeId);status('App Store 应用设置已保存');
 }}]);
}
function newProduct(){return {productId:'',name:'',inAppPurchaseType:'CONSUMABLE',reviewNote:'',localizations:[{locale:'en-US',name:'',description:''}]};}
function edit(p,isNew=false){
 function pull(){p.productId=$('editId').value.trim();p.name=$('editName').value;p.inAppPurchaseType=$('editType').value;p.reviewNote=$('editNote').value;p.localizations=[...document.querySelectorAll('[data-locale-row]')].map(row=>({locale:row.querySelector('[data-locale]').value.trim(),name:row.querySelector('[data-name]').value,description:row.querySelector('[data-description]').value}));
  if($('initialPrice').checked)p.initialPrice={territory:$('priceTerritory').value.trim(),currency:$('priceCurrency').value.trim(),price:$('priceAmount').value.trim()};else delete p.initialPrice;}
 function draw(){modal(isNew?'新建苹果内购':'编辑苹果内购','<div class="form-grid"><label class="field">商品 ID<input id="editId" value="'+esc(p.productId)+'" '+(!isNew?'readonly':'')+'></label><label class="field">参考名称（后台识别用）<input id="editName" value="'+esc(p.name)+'" maxlength="64"></label><label class="field">内购类型<select id="editType" '+(old(p.productId)?'disabled':'')+'><option value="CONSUMABLE" '+(p.inAppPurchaseType==='CONSUMABLE'?'selected':'')+'>消耗型（金币、道具）</option><option value="NON_CONSUMABLE" '+(p.inAppPurchaseType==='NON_CONSUMABLE'?'selected':'')+'>非消耗型（永久解锁）</option></select></label><label class="field wide">审核备注<textarea id="editNote" maxlength="4000">'+esc(p.reviewNote)+'</textarea></label></div><div class="section-title">多语言文案 <button id="addLocale">添加语言</button></div><p class="help">语言示例：en-US、zh-Hans、zh-Hant、ja。显示名称 2–30 字符，描述最多 45 字符。未列出的已有语言会保留。</p>'+p.localizations.map((l,i)=>'<div class="locale-card" data-locale-row><div class="locale-fields"><label class="field">语言代码<input aria-label="语言代码" data-locale value="'+esc(l.locale)+'" placeholder="如 zh-Hans"></label><label class="field">显示名称<input aria-label="显示名称" data-name value="'+esc(l.name)+'" maxlength="30"><small>用户看到的名称，2–30 字符</small></label><label class="field">描述<textarea aria-label="描述" data-description maxlength="45">'+esc(l.description)+'</textarea><small>填写商品用途，最多 45 字符</small></label></div><div class="locale-actions"><button data-remove="'+i+'" '+(old(p.productId)?.localizations.some(x=>x.locale===l.locale)?'disabled':'')+'>移除语言</button></div></div>').join('')+'<section class="option-box"><label><input id="initialPrice" type="checkbox" '+(p.initialPrice?'checked':'')+'> 设置初始基准价格</label><p class="help">仅用于没有价格计划的商品。新商品创建后查询 Apple 档位；金额不匹配时，商品会保留并提示定价未完成。其他地区由 Apple 自动生成价格，销售地区仍需在后台配置。</p><div class="form-grid"><label class="field">基准地区（三位代码）<input id="priceTerritory" value="'+esc(p.initialPrice?.territory||'USA')+'"></label><label class="field">币种<input id="priceCurrency" value="'+esc(p.initialPrice?.currency||'USD')+'"></label><label class="field">金额<input id="priceAmount" value="'+esc(p.initialPrice?.price||'0.99')+'"></label></div></section>',[{label:'取消',run:close},{label:'保存草稿',class:'primary',run:async()=>{pull();if(isNew&&draft.some(x=>x.productId===p.productId))throw Error('商品 ID 已存在');await api('validate',{product:p});replace([p]);close();status('草稿已保存在本机');}}]);
 bind('addLocale',()=>{pull();p.localizations.push({locale:'',name:'',description:''});draw();});document.querySelectorAll('[data-remove]').forEach(x=>x.onclick=()=>run(()=>{pull();p.localizations.splice(Number(x.dataset.remove),1);draw();}));}
 draw();
}
function download(name,text,type='text/csv;charset=utf-8'){const a=document.createElement('a'),url=URL.createObjectURL(new Blob([text],{type}));a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
function importDialog(){
 modal('导入苹果 CSV','<p>每个商品、每种语言一行；相同商品的参考名称和类型必须一致。使用 UTF-8 CSV。</p><label class="field">CSV 文件<input type="file" accept=".csv" id="csvFile"></label><p class="help">不会修改未列出的商品和语言；price、territory、currency 三列可全留空。</p>',[{label:'下载模板',run:async()=>{const p={...newProduct(),productId:'coins_100',name:'金币小礼包',localizations:[{locale:'zh-Hans',name:'100金币',description:'购买后获得100金币'}]};download('apple-products-template.csv',(await api('export',{products:[p]})).csv);}},{label:'取消',run:close},{label:'检查导入',class:'primary',run:async()=>{
  const f=$('csvFile').files[0];if(!f)throw Error('请选择 CSV 文件');if(f.size>2*1024*1024)throw Error('CSV 超过 2MB，请分批');const result=await api('import',{csv:await f.text(),existing:draft});modal('核对导入草稿','<p>将合并 '+result.products.length+' 个商品，确认后仅保存到本机。</p><pre>'+esc(JSON.stringify(result.products,null,2))+'</pre>',[{label:'返回',run:importDialog},{label:'应用到本机草稿',class:'primary',run:()=>{replace(result.products);close();status('导入草稿完成，尚未上传');}}]);
 }}]);
}
async function loadProducts(){const data=await job(()=>api('products'));base=data.products;draft=base.map(editable);selected.clear();persist();render();close();status('读取完成，共 '+draft.length+' 个苹果商品');}
function refresh(){if(draft.some(dirty)){modal('读取前处理本机草稿','<p>重新读取将替换本机草稿。需要保留时先导出 CSV。</p>',[{label:'取消',run:close},{label:'放弃草稿并读取',run:loadProducts}]);}else return loadProducts();}
async function preview(){
 persist();const items=draft.filter(p=>dirty(p)&&(!selected.size||selected.has(p.productId))).map(after=>({before:old(after.productId),after}));
 const plan=await job(()=>api('preview',{items}));status('预览完成，请核对差异后确认上传');modal('确认上传到苹果','<p><b>'+esc(settings.current.name)+'</b> · '+esc(plan.bundleId)+' · Apple ID '+esc(plan.appId)+'</p><p>'+plan.entries.length+' 个商品。上传文案不代表通过审核；本次不送审。</p>'+plan.entries.map(e=>'<details open><summary>'+esc(e.after.productId)+'</summary><pre>'+esc(JSON.stringify(e.changes,null,2))+'</pre></details>').join(''),[{label:'取消',run:close},{label:'确认上传 '+plan.entries.length+' 个商品',class:'primary',run:async()=>{
  const result=await job(()=>api('commit',{id:plan.id,appId:plan.appId,profileId:plan.profileId}));applyVerified(result.results,plan.entries.map(e=>e.after));showResult(result);
 }}]);
}
function applyVerified(results,targets=[]){for(const r of results)if(r.status==='verified'&&r.actual){const current=draft.find(p=>p.productId===r.productId),target=r.target||targets.find(p=>p.productId===r.productId);if(!current||!target||!sameDraft(current,target))continue;base=base.filter(x=>x.productId!==r.productId).concat(r.actual);draft=draft.filter(x=>x.productId!==r.productId).concat(editable(r.actual));}persist();render();}
function showResult(result){const verified=result.results.filter(r=>r.status==='verified').length;status('上传结束，'+verified+'/'+result.results.length+' 个商品已核对一致',verified!==result.results.length);modal('苹果上传结果','<ul>'+result.results.map(r=>'<li><b>'+esc(r.productId)+'</b> · '+esc(resultLabel(r.status))+'<p>'+esc(r.message||'')+'</p><small>完成步骤：'+esc((r.completed||[]).map(stepLabel).join('、'))+'</small></li>').join('')+'</ul><p>部分写入或结果不明时，请先核对远端，不要直接重复上传。</p>',[{label:'关闭',run:close},{label:'核对远端结果',run:()=>reconcile(result.logFile)}]);}
async function reconcile(logFile){
 const result=await job(()=>api('reconcile',{logFile}));applyVerified(result.results);status('核对完成，请查看逐项结果');
 const readable=result.results.filter(r=>r.status!=='verified'&&r.canLoadCurrent);
 const html='<p>与原目标一致的本机草稿已清除待上传标记；之后另做的本机修改会保留。未完成项可核对当前值和原目标，再编辑剩余内容。</p>'+result.results.map(r=>'<details><summary>'+esc(r.productId)+' · '+esc(resultLabel(r.status))+'</summary><p>'+esc(r.message||'')+'</p>'+(!r.canLoadCurrent?'<p>当前值未读取成功，本机草稿保留。</p>':'')+'<pre>'+esc(JSON.stringify({当前:r.actual,原目标:r.target},null,2))+'</pre></details>').join('');
 const actions=[{label:'关闭',run:close}];
 if(readable.length)actions.push({label:'载入 '+readable.length+' 个未完成项的当前值',run:()=>{
  for(const r of readable){
   base=base.filter(x=>x.productId!==r.productId);draft=draft.filter(x=>x.productId!==r.productId);
   if(r.actual){base.push(r.actual);draft.push(editable(r.actual));}else draft.push(clone(r.target));
  }
  persist();render();close();status('已载入 '+readable.length+' 个商品的当前值；读取失败的草稿保留。原目标仍在操作记录中。');
 }});
 modal('远端核对结果',html,actions);
}

async function history(){const data=await api('history');modal('苹果操作记录',data.operations.length?data.operations.map((o,i)=>'<div class="option-box">'+esc(o.startedAt)+' · '+o.results.length+' 个结果 <button data-history="'+i+'">核对结果</button></div>').join(''):'<p>当前 App Store 应用暂无操作记录。</p>',[{label:'关闭',run:close}]);document.querySelectorAll('[data-history]').forEach(x=>x.onclick=()=>run(()=>reconcile(data.operations[Number(x.dataset.history)].file)));}
async function init(){
 const session=await(await fetch('/api/session')).json();token=session.token;
 const systemApi=async(path,body={})=>{const s=await(await fetch('/api/session')).json();const r=await fetch('/api/'+path,{method:'POST',headers:{'Content-Type':'application/json','X-GP-Token':s.token},body:JSON.stringify(body)});const data=await r.json();if(!r.ok)throw Error(data.error||'请求失败');return data;};
 const system=SystemTools.create({esc,demo:()=>workspace.enterDemo(),api:systemApi,modal,close,status,job,download,persist,setWorking:value=>{working=value;},render});
 bind('update',system.updateDialog);bind('support',system.supportDialog);bind('about',()=>modal('关于 PlayBatch','<p>同一项目下分别管理 Google Play 与 App Store 商品、授权和草稿。</p><p>当前版本：'+esc(session.version)+'</p>',[{label:'关闭',run:close}]));
 $('appVersion').textContent='PlayBatch v'+session.version;settings=await api('config');restore();
 bind('settings',()=>workspace?workspace.configure():openSettings());bind('newProject',()=>openSettings(true));bind('closeModal',close);bind('refresh',refresh);bind('create',()=>edit(newProduct(),true));bind('import',importDialog);bind('preview',preview);bind('history',history);
 bind('export',async()=>download('apple-products.csv',(await api('export',{products:draft.filter(p=>!selected.size||selected.has(p.productId))})).csv));
 bind('copy',()=>{const p=clone(draft.find(x=>selected.has(x.productId)));p.productId='';p.name+=' 副本';delete p.initialPrice;edit(p,true);});
 bind('discard',()=>{modal('撤销所选草稿','<p>恢复为上次读取的内容；尚未创建的所选商品将移出本机草稿。</p>',[{label:'取消',run:close},{label:'确认撤销',run:()=>{for(const id of selected){draft=draft.filter(x=>x.productId!==id);if(old(id))draft.push(editable(old(id)));}selected.clear();persist();render();close();}}]);});
 $('search').oninput=render;$('selectAll').onchange=e=>{visible().forEach(p=>e.target.checked?selected.add(p.productId):selected.delete(p.productId));render();};
 $('project').onchange=()=>run(async()=>{persist();const id=$('project').value;settings=await job(()=>api('config/switch',{id}));restore();status('已切换苹果项目，点击读取商品或编辑草稿');});
 $('modal').addEventListener('cancel',e=>{if(working)e.preventDefault();});
 window.addEventListener('beforeunload',e=>{if(working){e.preventDefault();e.returnValue='';}});
 workspace=await WorkspaceShell.mount({platform:'apple',busy:()=>working,persist,profileId:()=>settings.activeId,isDemo:()=>false,modal,close,error:fail,status,
  configure:(id,name)=>{openSettings(!id);if(!id)$('profileName').value=name;},
  select:async id=>{if(!id){settings={...settings,activeId:'',current:{}};base=[];draft=[];selected.clear();render();return;}if(settings.activeId!==id)settings=await api('config/switch',{id});restore();}
 });
 void system.showUpdateOutcome(session.version).catch(()=>{});
}
init().catch(fail);
