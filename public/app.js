'use strict';
const $=id=>document.getElementById(id), esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const clone=v=>structuredClone(v), same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
let token='', settings={profiles:[],activeId:'',current:{}}, mode='demo',base=[],draft=[],states={},selected=new Set(),search='',activePlan=null,working=false;
const key=()=> 'gp-workspace-v1:'+mode+':'+(mode==='demo'?'demo':settings.activeId+':'+settings.current.packageName);
const old=id=>base.find(p=>p.productId===id)||null;
const dirty=p=>!same(p,old(p.productId))||Object.keys(states[p.productId]||{}).length>0;
let catalogFilter='all',productStateFilter='all';
function matchesProductState(p){return productStateFilter==='all'||p.purchaseOptions.some(o=>{const state=o.state||'DRAFT';return state===productStateFilter||(productStateFilter==='INACTIVE'&&state==='INACTIVE_PUBLISHED');});}
function visibleProducts(){return draft.filter(p=>matchesProductState(p)&&(p.productId+' '+p.listings.map(l=>l.title).join(' ')).toLowerCase().includes(search.toLowerCase())&&(catalogFilter==='all'||(catalogFilter==='dirty'?dirty(p):selected.has(p.productId))));}
function syncActions(){for(const id of ['copy','price','activate','deactivate','discard']){const disabled=working||!selected.size||(id==='copy'&&selected.size!==1);$(id).disabled=disabled;$(id).title=!selected.size?'请先勾选商品':id==='copy'&&selected.size!==1?'请选择一个商品作为复制模板':'';}$('clearSelection').hidden=!selected.size;document.querySelector('.batch').classList.toggle('has-selection',selected.size>0);}
function status(message,error=false){$('status').textContent=message;$('status').className=error?'error':'';}
async function api(url,body={},binary=false){
  // Freeze the target and payload across a retry; only a request rejected before routing is retried.
  const payload=JSON.stringify({...body,...(body.mode==='live'?{profileId:body.profileId??settings.activeId}:{})});
  for(let attempt=0;attempt<2;attempt++){
    const r=await fetch('/api/'+url,{method:'POST',headers:{'Content-Type':'application/json','X-GP-Token':token},body:payload});
    if(binary&&r.ok)return {blob:await r.blob(),sha256:r.headers.get('X-File-SHA256')};
    const data=await r.json();
    if(r.status===403&&data.error==='请从本机工具页面操作'&&attempt===0){
      const sessionResponse=await fetch('/api/session',{cache:'no-store'});
      const session=await sessionResponse.json();
      if(!sessionResponse.ok||session.application!=='gp-product-workbench'||!session.token)throw Error('本机会话已过期，请刷新工具页面后重试');
      token=session.token;
      continue;
    }
    if(!r.ok)throw Error(data.error||'请求失败');
    return data;
  }
}
function bind(id,fn){$(id).onclick=async()=>{if(working)return;try{await fn();}catch(e){showError(e.message);}};}

// Language catalog: Google Play localization help, checked 2026-09-15.
// https://support.google.com/googleplay/android-developer/answer/9844778?hl=en
const LANGUAGE_CODES='af sq am ar hy-AM az-AZ bn-BD eu-ES be bg my-MM ca zh-HK zh-CN zh-TW hr cs-CZ da-DK nl-NL en-AU en-CA en-US en-GB en-IN en-SG en-ZA et fil fi-FI fr-CA fr-FR gl-ES ka-GE de-DE el-GR gu iw-IL hi-IN hu-HU is-IS id it-IT ja-JP kn-IN kk km-KH ko-KR ky-KG lo-LA lv lt mk-MK ms-MY ms ml-IN mr-IN mn-MN ne-NP no-NO fa fa-AE fa-AF fa-IR pl-PL pt-BR pt-PT pa ro rm ru-RU sr si-LK sk sl es-419 es-ES es-US sw sv-SE ta-IN te-IN th tr-TR uk ur vi'.split(' ');
const REGION_CODES='AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW'.split(' ');
function choiceLabel(code,type){
  if(!code)return '';
  try{return new Intl.DisplayNames(['zh-CN'],{type}).of(code)+' · '+code;}catch{return code;}
}
function choiceOptions(codes,value,type,empty='请选择'){
  return '<option value="" '+(!value?'selected':'')+'>'+esc(empty)+'</option>'+[...new Set([...codes,...(value?[value]:[])])].map(c=>'<option value="'+esc(c)+'" '+(value===c?'selected':'')+'>'+esc(type?choiceLabel(c,type):c)+'</option>').join('');
}
const currencyCodes=()=>Intl.supportedValuesOf('currency');
function multiMarkup(id,title){
  return '<fieldset class="choice-picker wide" id="'+id+'"><legend>'+esc(title)+'</legend><div class="choice-tools"><input type="search" aria-label="搜索'+esc(title)+'" placeholder="搜索名称或代码"><button type="button" data-all>全选搜索结果</button><button type="button" data-clear>清空</button></div><div class="choice-summary" aria-live="polite"></div><div class="choice-list"></div></fieldset>';
}
function initMulti(id,codes,values,type){
  const root=$(id),chosen=new Set(values),all=[...new Set([...codes,...values])],input=root.querySelector('input[type=search]');
  const matches=()=>all.filter(c=>choiceLabel(c,type).toLowerCase().includes(input.value.trim().toLowerCase()));
  const draw=()=>{
    root.querySelector('.choice-summary').textContent='已选 '+chosen.size+' 项'+(chosen.size?'：'+[...chosen].join('、'):'');
    root.querySelector('.choice-list').innerHTML=matches().map(c=>'<label><input type="checkbox" value="'+esc(c)+'" '+(chosen.has(c)?'checked':'')+'><span>'+esc(choiceLabel(c,type))+'</span></label>').join('')||'<p class="help">没有匹配选项</p>';
    root.querySelectorAll('input[type=checkbox]').forEach(el=>el.onchange=()=>{el.checked?chosen.add(el.value):chosen.delete(el.value);root.querySelector('.choice-summary').textContent='已选 '+chosen.size+' 项'+(chosen.size?'：'+[...chosen].join('、'):'');});
  };
  input.oninput=draw;
  root.querySelector('[data-all]').onclick=()=>{matches().forEach(c=>chosen.add(c));draw();};
  root.querySelector('[data-clear]').onclick=()=>{chosen.clear();draw();};
  root.selectedValues=()=>[...chosen];draw();
}

function errorDetails(message){
  const disabled=/Google Play Android Developer API/i.test(message)&&/has not been used|disabled/i.test(message);
  const project=String(message).match(/project\s+(\d+)/i)?.[1];
  if(disabled){
    const link=project?'https://console.cloud.google.com/apis/library/androidpublisher.googleapis.com?project='+project:'https://console.cloud.google.com/apis/library/androidpublisher.googleapis.com';
    return '<h3>需要启用 Google Play Developer API</h3><p>当前凭据所属的 Cloud 项目'+(project?' <b>'+esc(project)+'</b>':'')+' 尚未启用此 API，或启用状态还未生效。</p><ol><li>打开下方 Google API 设置，确认选中的项目编号。</li><li>点击“启用”。如果已经启用，等待几分钟后再试。</li><li>回到本工具重新生成预览，草稿会保留。</li></ol><a class="api-settings-link" href="'+link+'" target="_blank" rel="noreferrer">打开 Google API 设置 ↗</a><details><summary>Google 原始错误</summary><p class="raw-error">'+esc(message)+'</p></details>';
  }
  return '<p class="raw-error">'+esc(message)+'</p>';
}
function showError(message){
  status(message,true);
  if(!$('modal').open){modal('操作未完成','<div class="error-box" role="alert">'+errorDetails(message)+'</div>',[{label:'关闭',run:close}]);return;}
  let box=$('modalError');if(!box){box=document.createElement('div');box.id='modalError';box.className='error-box';box.setAttribute('role','alert');$('dialogBody').append(box);}
  box.dataset.message=message;box.innerHTML=errorDetails(message);box.scrollIntoView({block:'nearest'});
}
async function job(fn,message){working=true;status(message||'处理中…');const buttons=[...document.querySelectorAll('button')];buttons.forEach(b=>b.disabled=true);$('mode').disabled=true;$('project').disabled=true;
  try{return await fn();}finally{working=false;buttons.forEach(b=>b.disabled=false);$('mode').disabled=false;renderHeader();}}
function persist(){
  try{
    if(!draft.some(dirty)){localStorage.removeItem(key());return true;}
    localStorage.setItem(key(),JSON.stringify({base,draft,states}));return true;
  }catch{status('本机草稿保存失败，请导出 JSON 备份后继续',true);return false;}
}
const VISIT_KEY='gp-last-visit-v1';
function rememberVisit(){try{localStorage.setItem(VISIT_KEY,JSON.stringify({mode,projectId:settings.activeId}));}catch{status('无法保存上次访问项目，请检查浏览器存储权限',true);}}
async function restoreVisit(){
  let visit=null;try{visit=JSON.parse(localStorage.getItem(VISIT_KEY)||'null');}catch{}
  mode=visit?.mode==='demo'?'demo':settings.profiles.length?'live':'demo';
  if(mode==='live'&&visit?.projectId&&settings.profiles.some(p=>p.id===visit.projectId)&&settings.activeId!==visit.projectId){
    settings=await api('config/switch',{id:visit.projectId});
  }
  $('mode').value=mode;
}
function restore(){rememberVisit();selected.clear();activePlan=null;try{const data=JSON.parse(localStorage.getItem(key())||'null');base=data?.base||[];draft=data?.draft||[];states=data?.states||{};}catch{base=[];draft=[];states={};}render();}
function renderHeader(){
  $('project').innerHTML=settings.profiles.length?settings.profiles.map(p=>'<option value="'+esc(p.id)+'">'+esc(p.name)+'</option>').join(''):'<option value="">尚未配置项目</option>';
  $('project').value=settings.activeId;$('project').disabled=working||mode==='demo';
  $('package').textContent=mode==='demo'?'com.example.demo':settings.current.packageName||'未配置包名';
  $('modeBanner').className='banner'+(mode==='live'?' live':'');
  $('modeBanner').innerHTML=mode==='demo'?'<b>演示工作区</b><span>示例商品保存在本机，所有操作均不调用 Google 商品写入接口。</span><button id="connectLink">连接我的应用 →</button>':'<b>真实项目 · '+esc(settings.current.name||'未配置')+'</b><span>草稿按项目保存。预览确认后才会修改 Google Play 商品。</span><button id="connectLink">管理项目 →</button>';
  bind('connectLink',()=>openSettings());syncActions();
}
function render(){
  renderHeader();const list=visibleProducts();
  $('resultCount').textContent='显示 '+list.length+' / '+draft.length+' 个商品';$('resetFilters').hidden=!search&&catalogFilter==='all'&&productStateFilter==='all';
  document.querySelectorAll('[data-filter]').forEach(b=>b.setAttribute('aria-pressed',b.dataset.filter===catalogFilter));
  $('total').textContent=draft.length;$('selectedCount').textContent=selected.size;
  const count=draft.filter(dirty).length;$('dirtyCount').textContent=count;$('pendingBadge').textContent=count;
  $('selectionHint').textContent=selected.size?'已选择 '+selected.size+' 个商品':'选择商品后执行批量操作';
  $('products').innerHTML=list.map(p=>{
    const o=p.purchaseOptions[0],price=o?.regionalPricingAndAvailabilityConfigs||[],allStates=[...new Set(p.purchaseOptions.map(x=>states[p.productId]?.[x.purchaseOptionId]||x.state||'DRAFT'))],s=allStates.length===1?allStates[0]:'MIXED';
    return '<tr class="'+(selected.has(p.productId)?'selected':'')+'"><td><input type="checkbox" aria-label="选择 '+esc(p.productId)+'" data-select="'+esc(p.productId)+'" '+(selected.has(p.productId)?'checked':'')+'></td><td><strong>'+esc(p.listings[0]?.title||p.productId)+'</strong><small>'+esc(p.productId)+'</small></td><td><span class="pill">'+p.purchaseOptions.length+' 个选项</span><small>'+esc(o?.purchaseOptionId||'')+' · '+p.listings.length+' 种语言</small></td><td>'+price.slice(0,2).map(r=>'<div class="price-line"><span>'+esc(r.regionCode)+'</span>'+esc(r.price?.currencyCode)+' '+esc(decimal(r.price))+'</div>').join('')+(price.length>2?'<small>共 '+price.length+' 个地区</small>':'')+'</td><td><span class="pill '+(s==='ACTIVE'?'green':'')+'">'+esc((Object.values(states[p.productId]||{}).length?'待提交 · ':'')+({ACTIVE:'已启用',DRAFT:'草稿',INACTIVE:'已停用',INACTIVE_PUBLISHED:'已停用 · 兼容',MIXED:'多种状态'}[s]||s))+'</span></td><td>'+(dirty(p)?'<span class="pill orange">'+(old(p.productId)?'待更新':'待创建')+'</span>':'<span class="pill" title="本地与上次读取的配置一致，不表示刚刚向 Google 提交了修改">无待提交修改</span>')+'</td><td><button data-edit="'+esc(p.productId)+'">编辑</button></td></tr>';
  }).join('');
  $('empty').hidden=list.length>0;
  $('empty').innerHTML=draft.length?'<div class="empty-symbol">⌕</div><h2>没有匹配的商品</h2><p>试试其他名称、商品 ID，或清除当前筛选。</p>':'<div class="empty-symbol">＋</div><h2>从读取商品开始</h2><p>连接应用后读取商品，或创建第一个商品草稿。</p>';
  const hiddenSelection=[...selected].filter(id=>!list.some(p=>p.productId===id)).length;
  if(hiddenSelection)$('selectionHint').textContent+='（含筛选外 '+hiddenSelection+' 个）';
  $('selectAll').checked=list.length>0&&list.every(p=>selected.has(p.productId));
  $('selectAll').indeterminate=list.some(p=>selected.has(p.productId))&&!$('selectAll').checked;
  document.querySelectorAll('[data-select]').forEach(el=>el.onchange=()=>{el.checked?selected.add(el.dataset.select):selected.delete(el.dataset.select);render();});
  document.querySelectorAll('[data-edit]').forEach(el=>el.onclick=()=>edit(clone(draft.find(p=>p.productId===el.dataset.edit))));
}
function decimal(m){return m?String(m.units||'0')+(m.nanos?'.'+String(m.nanos).padStart(9,'0').replace(/0+$/,''):''):'';}
function makeMoney(value,currency){const s=String(value).trim();if(!/^\d+(\.\d{1,9})?$/.test(s))throw Error('价格格式错误');const [u,f='']=s.split('.');return {currencyCode:currency.toUpperCase(),units:String(BigInt(u)),nanos:Number(f.padEnd(9,'0'))};}
function modal(title,body,actions=[]){
  $('modal').returnToEditor=null;
  $('dialogTitle').textContent=title;$('dialogBody').innerHTML=body;$('dialogActions').innerHTML='';
  for(const a of actions){const b=document.createElement('button');b.textContent=a.label;b.className=a.class||'';b.onclick=async()=>{if(working)return;try{await a.run();}catch(e){showError(e.message);}};$('dialogActions').append(b);}
  if(!$('modal').open)$('modal').showModal();$('dialogBody').scrollTop=0;
}
function close(){if(!working){const back=$('modal').returnToEditor;if(back){$('modal').returnToEditor=null;back();}else $('modal').close();}}
function picked(){const list=draft.filter(p=>selected.has(p.productId));if(!list.length)throw Error('请先选择商品');return list;}
function replace(products){for(const p of products){const i=draft.findIndex(x=>x.productId===p.productId);if(i<0)draft.push(p);else draft[i]=p;selected.add(p.productId);}activePlan=null;persist();render();}
async function loadProducts(rebase=false){
  await job(async()=>{
    const data=await api('products',{mode});const edits=draft.filter(dirty);
    if(rebase){
      // Keep unsubmitted drafts, while retaining their original baseline for conflict detection.
      const oldBase=base;const preserved=new Set(edits.map(p=>p.productId));
      base=data.products.filter(p=>!preserved.has(p.productId)).concat(oldBase.filter(p=>preserved.has(p.productId)));
      draft=data.products.filter(p=>!preserved.has(p.productId)).concat(edits);
    }else{base=data.products;draft=clone(base);states={};}
    activePlan=null;selected.clear();const saved=persist();render();if(saved)status('已读取 '+data.products.length+' 个商品'+(rebase?'；未提交草稿已保留':''));
  },'正在读取全部商品…');
}
function refresh(){
  if(draft.some(dirty)){modal('刷新商品', '<p>当前有未提交草稿。保留草稿会保留它们原来的版本依据，提交时仍检查远端冲突。</p>',[
    {label:'取消',run:close},{label:'放弃草稿并重新读取',run:async()=>{localStorage.removeItem(key());draft=clone(base);states={};activePlan=null;selected.clear();render();close();await loadProducts();}},
    {label:'保留草稿并读取',class:'primary',run:async()=>{close();await loadProducts(true);}}]);}
  else return loadProducts();
}
const AUTH_GUIDE_HTML="<details class=\"auth-guide\"><summary>如何准备 Google 授权？（完整步骤）</summary>\n<p>本工具使用服务账号。最终只需下载一个 JSON 文件并在上方导入。配置分为 Google Cloud 和 Play Console 两部分。</p>\n<h3>1 · 准备管理员权限</h3><p>需要有人能在 Google Cloud 创建项目、服务账号和密钥，并在 Play Console 邀请用户、授予目标应用权限。两边可由不同管理员完成。</p>\n<h3>2 · 选择 Cloud 项目并启用 API</h3><ol><li>打开 <a href=\"https://console.cloud.google.com/\" target=\"_blank\" rel=\"noreferrer\">Google Cloud Console</a>，在顶部选择项目；已有项目可复用，也可新建，例如 gp-product-tools。</li><li>进入“API 和服务 → 库”，搜索 Google Play Android Developer API，核对服务名 <code>androidpublisher.googleapis.com</code> 并点击启用。<a href=\"https://console.cloud.google.com/apis/library/androidpublisher.googleapis.com\" target=\"_blank\" rel=\"noreferrer\">直接打开 API 页面</a>。</li></ol><p>Cloud 项目 ID 与 Android 包名是两回事。现在无需再把 Play 开发者账号与 Cloud 项目执行关联操作。<a href=\"https://developers.google.com/android-publisher/getting_started\" target=\"_blank\" rel=\"noreferrer\">官方接入说明</a></p>\n<h3>3 · 创建服务账号</h3><ol><li>打开 <a href=\"https://console.cloud.google.com/iam-admin/serviceaccounts\" target=\"_blank\" rel=\"noreferrer\">IAM 和管理 → 服务账号</a>，确认仍是刚才的 Cloud 项目。</li><li>点击“创建服务账号”，名称可填 gp-product-manager，然后完成创建。</li><li>创建向导中的 Cloud 项目角色和用户授权均为可选。此工具的商品权限将在 Play Console 设置，不需要为了调用商品接口给服务账号 Cloud Owner/Editor。</li><li>复制生成的邮箱，例如 <code>gp-product-manager@你的项目ID.iam.gserviceaccount.com</code>。</li></ol>\n<h3>4 · 下载 JSON 密钥</h3><ol><li>点击服务账号邮箱，打开“密钥 / Keys”。</li><li>点击“添加密钥 / Add key → 创建新密钥 / Create new key”。</li><li>选择 <b>JSON</b>，点击创建，浏览器下载文件。保留这个原始文件；同一私钥不能再次下载。</li></ol><p>若提示组织政策禁止创建密钥，请找 Cloud 管理员评估该项目的例外或其他认证方案。当前工具尚不支持无密钥认证。<a href=\"https://docs.cloud.google.com/iam/docs/keys-create-delete\" target=\"_blank\" rel=\"noreferrer\">密钥创建说明</a></p>\n<h3>5 · 在 Play Console 授权</h3><ol><li>打开 <a href=\"https://play.google.com/console/\" target=\"_blank\" rel=\"noreferrer\">Play Console</a>，选择目标开发者账号。</li><li>进入“用户和权限 / Users and permissions → 邀请新用户”。</li><li>填入第 3 步的服务账号邮箱；不要填你自己的登录邮箱。</li><li>在“应用权限”中添加需要管理的应用。建议先选一个测试用应用，再增加其他应用。</li><li>在目标应用的权限中，选择“管理商店发布信息 / Manage store presence”，其官方说明包含改价和管理应用内商品。不要将“只读”作为本工具的唯一访问权限。如果当前页面的只读访问与管理权限互斥，请选择管理权限，不要求同时勾选。若查看权限由系统自动勾选或继承，保留系统状态即可。官方文档区分应用级和账号级权限，但未说明所有页面的勾选联动；以当前页面为准，再用实际接口验证。<a href=\"https://support.google.com/googleplay/android-developer/answer/9844686?hl=en\" target=\"_blank\" rel=\"noreferrer\">完整权限说明</a></li><li>保存并发送邀请。服务账号通过被授予权限使用 API，不需要你登录它的邮箱。</li></ol><p>本工具采用上述商品管理权限起步；尚未对你的账号验证其充分性。Google 的 Billing API 通用接入文档还列出查看财务数据/订单、管理订单和订阅权限；这些涉及更广的能力，如具体接口报权限不足，应核对接口和错误后由管理员补充。不要直接把全部管理员权限当作默认配置。</p>\n<h3>6 · 回到本地工具验证</h3><ol><li>填写项目名称和应用包名，例如 <code>com.company.game</code>。包名取自 Play Console 的目标应用，不是 Cloud 项目 ID，也不是开发者账号数字 ID。</li><li>在上方选择刚下载的 JSON 文件，或粘贴完整 JSON，点击“保存并切换到此项目”。不需要填写文件路径。</li><li>看到“已保存”及服务账号邮箱后，点击首页“读取商品”。成功返回商品或空列表，表示读取接口已打通。</li><li>读取成功不代表写入权限已经验证。首次写入应选择你允许修改的测试商品，预览后提交，并核对后台。</li></ol>\n<h3>多个项目和替换凭据</h3><p>每个工具项目填写自己的包名。同一服务账号被授予多个应用权限时，可在多个项目导入同一 JSON；不同账号则分别导入。替换时打开对应项目设置，选择新文件或粘贴新 JSON 后保存。留空会保留原凭据，保存失败不替换。替换本地凭据不会自动撤销 Google 中的旧密钥。</p>\n<h3>遇到问题</h3><ul><li><b>API 未启用：</b>核对 JSON 所属 Cloud 项目是否启用了 androidpublisher.googleapis.com。</li><li><b>403 / 没有权限：</b>核对服务账号邮箱、开发者账号、应用授权和商品管理权限是否对应。</li><li><b>404 / 找不到应用：</b>核对应用包名和账号归属，也检查访问权限。</li><li><b>JSON 无效：</b>导入文件应含 type=service_account、client_email 和 private_key；API Key、OAuth 客户端文件不能替代。</li><li><b>新密钥刚创建就失败：</b>稍后再试；Google 提醒新密钥生效可能需 60 秒或更久。</li><li><b>无法解密：</b>使用保存时的 Windows 用户运行，或重新导入原始 JSON。</li></ul>\n<p>工具将凭据用 Windows 当前用户加密保存在本机，只显示邮箱和保存时间，不回显私钥。不要把原始 JSON 发到群聊或提交到代码仓库。</p></details>";
function openSettings(id=settings.activeId){
  const p=settings.profiles.find(p=>p.id===id)||{};
  const credentialStatus=p.hasCredential?'<span class="pill green">已保存</span> '+esc(p.credentialEmail||(p.legacyCredential?'旧版文件凭据 · 可重新导入迁移':'服务账号'))+(p.credentialUpdatedAt?' · '+esc(new Date(p.credentialUpdatedAt).toLocaleString()):''):'<span class="pill orange">尚未配置</span>';
  modal(p.id?'项目与连接设置':'新建项目','<p class="help">每个项目独立配置包名。选择文件或粘贴 JSON 后加密保存在本机，页面不回显已保存的私钥。</p><div class="form-grid"><div class="wide profile-picker"><label class="field">选择配置<select id="profileEdit"><option value="">＋ 新增项目</option>'+settings.profiles.map(x=>'<option value="'+esc(x.id)+'" '+(x.id===id?'selected':'')+'>'+esc(x.name)+'</option>').join('')+'</select></label><button id="addProject" type="button">＋ 新建项目</button></div><label class="field">项目名称<input id="profileName" value="'+esc(p.name)+'" placeholder="例如：游戏 A · 正式"></label><label class="field">Android 应用包名<input id="profilePackage" value="'+esc(p.packageName)+'" placeholder="com.company.game"></label><div class="wide"><div class="section-title">服务账号凭据</div><div id="credentialStatus">'+credentialStatus+'</div><p class="help">留空保留原凭据。选择新文件或填写新 JSON 并保存，即替换此项目凭据；也可先保存项目，稍后再导入。</p><label class="field">'+(p.hasCredential?'选择替换用 JSON 文件':'选择 Google 服务账号 JSON 文件')+'<input id="credentialFile" type="file" accept=".json,application/json"></label><details><summary>或直接粘贴 JSON 内容</summary><label class="field">服务账号 JSON<textarea id="credentialJson" spellcheck="false" autocomplete="off" placeholder="粘贴 Google 下载的完整 JSON，保存后不回显"></textarea></label></details><p id="credentialSelected" class="help"></p></div></div>'+AUTH_GUIDE_HTML,[
    {label:'取消',run:close},{label:p.id?'保存并切换到此项目':'创建并切换到此项目',class:'primary',run:async()=>{
      const f=$('credentialFile').files[0],pasted=$('credentialJson').value.trim();
      if(f&&pasted)throw Error('请选择文件或粘贴 JSON 其中一种，避免替换来源不明确');
      if(f&&f.size>65536)throw Error('JSON 文件超过 64KB');
      const credentialJson=f?await f.text():pasted;
      const body={id:p.id||'',name:$('profileName').value,packageName:$('profilePackage').value.trim(),credentialJson};
      persist();settings=await job(()=>api('config/save',body),'正在加密保存项目凭据…');
      $('credentialJson').value='';$('credentialFile').value='';
      mode='live';$('mode').value=mode;restore();close();status('已切换到 '+settings.current.name+'。'+(settings.current.hasCredential?'凭据已保存，可点击“读取商品”测试连接。':'可稍后在连接设置中导入凭据。'));
    }}]);
  $('profileEdit').value=p.id||'';
  $('profileEdit').onchange=()=>openSettings($('profileEdit').value);
  bind('addProject',()=>openSettings(''));
  if(!p.id)$('profileName').focus();
  $('credentialFile').onchange=()=>{$('credentialSelected').textContent=$('credentialFile').files[0]?'待保存文件：'+$('credentialFile').files[0].name:'';};
}
function newProduct(){
  const pkg=mode==='demo'?'com.example.demo':settings.current.packageName;
  if(!pkg)throw Error('请先添加项目并配置包名');
  edit({packageName:pkg,productId:'',listings:[{languageCode:'en-US',title:'',description:''}],purchaseOptions:[{purchaseOptionId:'buy',buyOption:{legacyCompatible:true},regionalPricingAndAvailabilityConfigs:[{regionCode:'US',price:makeMoney('0.99','USD'),availability:'AVAILABLE'}]}]},true);
}
function edit(p,isNew=false){
  const originalId=p.productId;
  function draw(){
    modal(isNew?'新建商品':'编辑商品 · '+p.productId,
      '<div class="form-grid"><label class="field">商品 ID<input id="editId" value="'+esc(p.productId)+'" '+(!isNew?'readonly':'')+' placeholder="coins_100"></label><label class="field">所属应用<input readonly value="'+esc(p.packageName)+'"></label></div>'+
      '<div class="section-title">多语言名称与描述 <div class="section-actions"><button id="editLanguages">多语言模板</button> <button id="addLocale">＋ 添加语言</button></div></div><div class="help">语言代码 / 名称（最多 55 字符）/ 描述（最多 200 字符）</div><div id="locales">'+p.listings.map((l,i)=>'<div class="edit-row locale-row"><select aria-label="语言代码" data-l="'+i+'" data-k="languageCode">'+choiceOptions(LANGUAGE_CODES,l.languageCode,'language','请选择语言')+'</select><input aria-label="商品名称" data-l="'+i+'" data-k="title" value="'+esc(l.title)+'"><textarea aria-label="商品描述" data-l="'+i+'" data-k="description">'+esc(l.description)+'</textarea><button data-del-l="'+i+'" aria-label="删除语言">×</button></div>').join('')+'</div>'+
      '<div class="section-title">购买选项与地区价格 <button id="addOption">＋ 添加购买选项</button></div>'+p.purchaseOptions.map((o,i)=>'<section class="option-box"><div class="option-head"><b>选项</b><input type="text" aria-label="购买选项 ID" data-oid="'+i+'" value="'+esc(o.purchaseOptionId)+'" '+(old(originalId)?.purchaseOptions.some(x=>x.purchaseOptionId===o.purchaseOptionId)?'readonly':'')+'><span class="pill">'+esc(o.state||'DRAFT')+'</span>'+(o.buyOption?'<label><input type="checkbox" data-legacy="'+i+'" '+(o.buyOption.legacyCompatible?'checked':'')+'>兼容旧版 Billing</label><label><input type="checkbox" data-multi="'+i+'" '+(o.buyOption.multiQuantityEnabled?'checked':'')+'>允许多件购买</label>':'<span>租赁选项 · 在高级 JSON 中编辑租期</span>')+'</div><div class="region-tools"><input type="search" data-region-search="'+i+'" aria-label="搜索购买选项 '+esc(o.purchaseOptionId)+' 的地区" placeholder="搜索地区名称、代码或币种"><span data-region-count="'+i+'">共 '+o.regionalPricingAndAvailabilityConfigs.length+' 个地区</span></div><div class="help">地区 / 币种 / 价格 / 销售状态</div><div class="region-scroll">'+o.regionalPricingAndAvailabilityConfigs.map((r,j)=>'<div class="edit-row region-row"><select aria-label="地区代码" data-o="'+i+'" data-r="'+j+'" data-k="regionCode">'+choiceOptions(REGION_CODES,r.regionCode,'region')+'</select><select aria-label="币种" data-o="'+i+'" data-r="'+j+'" data-k="currencyCode">'+choiceOptions(currencyCodes(),r.price?.currencyCode,'currency')+'</select><input aria-label="地区价格" data-o="'+i+'" data-r="'+j+'" data-k="price" value="'+esc(decimal(r.price))+'"><select aria-label="地区销售状态" data-o="'+i+'" data-r="'+j+'" data-k="availability">'+['AVAILABLE','NO_LONGER_AVAILABLE','AVAILABLE_IF_RELEASED','AVAILABLE_FOR_OFFERS_ONLY'].map(a=>'<option '+(r.availability===a?'selected':'')+' value="'+a+'">'+({AVAILABLE:'可销售',NO_LONGER_AVAILABLE:'停止销售',AVAILABLE_IF_RELEASED:'预购发布后可售',AVAILABLE_FOR_OFFERS_ONLY:'仅优惠可售'}[a])+'</option>').join('')+'</select><button data-del-r="'+i+','+j+'" aria-label="移除地区行">×</button></div>').join('')+'</div><button data-add-r="'+i+'">＋ 添加地区</button></section>').join('')+
      '<p class="help">修改只保存为本地草稿。已有购买选项的启用/停用请使用列表中的批量操作。</p><details><summary>高级字段（标签、税务、租赁、新地区规则等）</summary><p class="help">JSON 编辑保留已有字段；商品图标和促销优惠不在本版编辑范围。</p><button id="advanced">打开完整 JSON 编辑器</button></details>',[
      {label:'取消',run:close},{label:'保存草稿',class:'primary',run:async()=>{pull();if(isNew&&draft.some(x=>x.productId===p.productId))throw Error('商品 ID 已存在');await api('validate',{product:p});replace([p]);close();status('商品已保存为本地草稿');}}]);
    document.querySelectorAll('[data-region-search]').forEach(input=>input.oninput=()=>{
      const box=input.closest('.option-box'),query=input.value.trim().toLowerCase();let count=0;
      box.querySelectorAll('.region-row').forEach(row=>{const region=row.querySelector('[data-k="regionCode"]').value,currency=row.querySelector('[data-k="currencyCode"]').value;row.hidden=!(choiceLabel(region,'region')+' '+choiceLabel(currency,'currency')).toLowerCase().includes(query);if(!row.hidden)count++;});
      box.querySelector('[data-region-count]').textContent='显示 '+count+' 个地区';
    });
    bind('editLanguages',()=>{pull();if(!p.productId)throw Error('请先填写商品 ID');languageDialog({products:[p],back:draw,apply:products=>{p.listings=clone(products[0].listings);draw();}});});
    bind('addLocale',()=>{pull();p.listings.push({languageCode:'',title:'',description:''});draw();});
    bind('addOption',()=>{pull();p.purchaseOptions.push({purchaseOptionId:'buy-'+(p.purchaseOptions.length+1),buyOption:{},regionalPricingAndAvailabilityConfigs:[]});draw();});
    document.querySelectorAll('[data-del-l]').forEach(el=>el.onclick=()=>{try{pull();p.listings.splice(Number(el.dataset.delL),1);draw();}catch(e){showError(e.message);}});
    document.querySelectorAll('[data-add-r]').forEach(el=>el.onclick=()=>{try{pull();p.purchaseOptions[el.dataset.addR].regionalPricingAndAvailabilityConfigs.push({regionCode:'',price:makeMoney('0.99','USD'),availability:'AVAILABLE'});draw();}catch(e){showError(e.message);}});
    document.querySelectorAll('[data-del-r]').forEach(el=>el.onclick=()=>{try{pull();const [i,j]=el.dataset.delR.split(',').map(Number);const row=p.purchaseOptions[i].regionalPricingAndAvailabilityConfigs[j];if(old(originalId)?.purchaseOptions.find(o=>o.purchaseOptionId===p.purchaseOptions[i].purchaseOptionId)?.regionalPricingAndAvailabilityConfigs.some(r=>r.regionCode===row.regionCode))throw Error('已有地区请改为“停止销售”，不能直接移除');p.purchaseOptions[i].regionalPricingAndAvailabilityConfigs.splice(j,1);draw();}catch(e){showError(e.message);}});
    bind('advanced',()=>{pull();modal('完整商品 JSON','<p class="help">保留所有不需要修改的字段。state 为只读状态。保存后仍需预览才能提交。</p><textarea class="code" id="productJson">'+esc(JSON.stringify(p,null,2))+'</textarea>',[{label:'返回表单',run:draw},{label:'应用到表单',class:'primary',run:async()=>{const next=JSON.parse($('productJson').value);if(next.packageName!==p.packageName||(!isNew&&next.productId!==originalId))throw Error('不能修改现有商品 ID 或包名');await api('validate',{product:next});p=next;draw();}}]);});
  }
  function pull(){
    p.productId=$('editId').value.trim();
    document.querySelectorAll('[data-l]').forEach(el=>p.listings[el.dataset.l][el.dataset.k]=el.value);
    document.querySelectorAll('[data-oid]').forEach(el=>p.purchaseOptions[el.dataset.oid].purchaseOptionId=el.value.trim());
    document.querySelectorAll('[data-legacy]').forEach(el=>p.purchaseOptions[el.dataset.legacy].buyOption.legacyCompatible=el.checked);
    document.querySelectorAll('[data-multi]').forEach(el=>p.purchaseOptions[el.dataset.multi].buyOption.multiQuantityEnabled=el.checked);
    document.querySelectorAll('[data-r]').forEach(el=>{const r=p.purchaseOptions[el.dataset.o].regionalPricingAndAvailabilityConfigs[el.dataset.r];if(el.dataset.k==='currencyCode'){r.price.currencyCode=el.value.toUpperCase();}else if(el.dataset.k!=='price')r[el.dataset.k]=el.value;});
    document.querySelectorAll('[data-k="price"]').forEach(el=>{const r=p.purchaseOptions[el.dataset.o].regionalPricingAndAvailabilityConfigs[el.dataset.r];r.price=makeMoney(el.value,r.price.currencyCode);});
  }
  draw();
}
function copyProducts(){
  const source=picked();if(source.length!==1)throw Error('复制创建时请选择一个模板商品');
  modal('从模板批量创建','<p class="help">复用 '+esc(source[0].productId)+' 的所有商品配置。每行填写一个新商品 ID；新购买选项创建为草稿，不会自动启用。</p><label class="field">新商品 ID（每行一个）<textarea id="copyIds" placeholder="coins_200&#10;coins_300"></textarea></label>',[{label:'取消',run:close},{label:'生成商品草稿',class:'primary',run:async()=>{
    const ids=$('copyIds').value.split(/\r?\n/).map(x=>x.trim()).filter(Boolean);if(!ids.length||ids.length>500)throw Error('请输入 1–500 个商品 ID');
    if(new Set(ids).size!==ids.length||ids.some(id=>draft.some(p=>p.productId===id)))throw Error('商品 ID 重复或已存在');
    const products=ids.map(id=>{const p=clone(source[0]);p.productId=id;delete p.regionsVersion;for(const o of p.purchaseOptions){delete o.state;o.regionalPricingAndAvailabilityConfigs=o.regionalPricingAndAvailabilityConfigs.filter(r=>r.availability!=='NO_LONGER_AVAILABLE');}return p;});
    await job(async()=>{for(const p of products)await api('validate',{product:p});},'正在检查新商品…');selected.clear();replace(products);close();status('已生成 '+products.length+' 个草稿，可逐个修改名称和价格');
  }}]);
}
function priceDialog(){
  const products=picked(),regions=[...new Set(products.flatMap(p=>p.purchaseOptions.flatMap(o=>o.regionalPricingAndAvailabilityConfigs.map(r=>r.regionCode))))];
  modal('批量改价 · '+products.length+' 个商品','<p class="help">先修改所选商品的本地草稿，提交前会展示每个地区的前后价格。比例调价按币种常用小数位四舍五入。</p><div class="form-grid price-form"><label class="field">调价方式<select id="priceKind"><option value="fixed">指定新价格（限定币种）</option><option value="percent">按百分比调整</option><option value="convert">Google 基准价换算</option></select></label><label class="field">价格 / 调价百分比<input id="priceValue" placeholder="例如 4.99；或 -10 表示降价 10%"></label><label class="field">币种<select id="priceCurrency">'+choiceOptions(currencyCodes(),'USD','currency','所有币种（仅比例调价）')+'</select></label><label class="field">购买选项 ID<select id="priceOption">'+choiceOptions(products.flatMap(p=>p.purchaseOptions.map(o=>o.purchaseOptionId)),'',null,'全部购买选项')+'</select></label>'+multiMarkup('priceRegions','目标地区（多选）')+'<label class="field wide" id="regionScopeField" hidden>地区处理方式<select id="regionScope"><option value="existing">仅更新勾选的已有地区</option><option value="all">添加并设为可销售：Google 返回的全部地区</option></select></label><label class="field wide">税务类别代码（仅换算，可选）<select id="taxCategory">'+choiceOptions(products.map(p=>p.taxAndComplianceSettings?.productTaxCategoryCode||'').filter(Boolean),products[0].taxAndComplianceSettings?.productTaxCategoryCode||'',null,'Google 默认税务类别')+'</select></label></div><div class="warning" id="convertNote" hidden>基准换算输入为税前价格；返回地区价格含税。选择“全部地区”会新增缺少的地区，并把 Google 返回的地区设为可销售、替换其价格。应用本身的发行地区不会改变；未来新地区的自动销售规则保留原配置。先核对换算结果，再应用到草稿。</div>',[{label:'取消',run:close},{label:'计算并应用到草稿',class:'primary',run:async()=>{
    const kind=$('priceKind').value,currency=$('priceCurrency').value.trim().toUpperCase(),value=$('priceValue').value.trim(),target=$('priceRegions').selectedValues(),optionId=$('priceOption').value.trim(),allRegions=kind==='convert'&&$('regionScope').value==='all';
    if(!target.length&&!allRegions)throw Error('请指定地区');
    if(kind==='convert'){
      const category=$('taxCategory').value.trim();
      const categories=new Set(products.map(p=>p.taxAndComplianceSettings?.productTaxCategoryCode||''));
      if(categories.size>1||!categories.has(category))throw Error('换算时请选择相同税务类别的商品，并选择与商品一致的税务类别');
      const conversion=await job(()=>api('convert',{mode,price:value,currency,productTaxCategoryCode:category}),'正在获取 Google 地区换算价格…');
      const next=clone(products),rows=[];
      const available=Object.entries(conversion.convertedRegionPrices||{});
      if(!available.length)throw Error('Google 未返回可用地区，未修改草稿');
      if(!conversion.regionVersion?.version)throw Error('Google 未返回地区版本，未修改草稿');
      for(const p of next)for(const o of p.purchaseOptions)if(!optionId||optionId===o.purchaseOptionId){
        o.regionalPricingAndAvailabilityConfigs||=[];
        const targets=allRegions?available.map(([code,r])=>r.regionCode||code):target;
        for(const code of targets){
          let r=o.regionalPricingAndAvailabilityConfigs.find(x=>x.regionCode===code);
          if(!r&&!allRegions)continue;
          const converted=conversion.convertedRegionPrices?.[code];
          if(!converted?.price)throw Error('Google 未返回地区 '+code+' 的价格');
          rows.push({id:p.productId,option:o.purchaseOptionId,region:code,before:r?.price,after:converted.price,beforeAvailability:r?.availability,afterAvailability:allRegions?'AVAILABLE':r.availability});
          if(!r){r={regionCode:code,availability:'AVAILABLE'};o.regionalPricingAndAvailabilityConfigs.push(r);}
          r.price=clone(converted.price);
          if(allRegions)r.availability='AVAILABLE';
        }
        p.regionsVersion=clone(conversion.regionVersion);
      }
      if(!rows.length)throw Error('没有匹配地区');
      modal('Google 换算结果','<p class="help">以下为 Google 返回的含税地区价格。选择全部地区时，以下地区均设为可销售；确认后仅更新本地草稿。同一基准价会应用于本次所选商品，请按相同价格档位分批操作。</p><table><thead><tr><th>商品 / 选项 / 地区</th><th>当前</th><th>换算后</th></tr></thead><tbody>'+rows.map(r=>'<tr><td>'+esc(r.id+' / '+r.option+' / '+r.region)+'</td><td>'+esc(r.before?r.before.currencyCode+' '+decimal(r.before):'新增地区')+'</td><td>'+esc(r.after.currencyCode+' '+decimal(r.after))+'<small>'+esc(r.beforeAvailability||'未配置')+' → '+esc(r.afterAvailability)+'</small>'+'</td></tr>').join('')+'</tbody></table>',[{label:'取消',run:close},{label:'应用到草稿',class:'primary',run:()=>{replace(next);close();status('已应用 '+rows.length+' 个地区价格');}}]);
    }else{
      const result=await api('adjust',{products,kind,value,currency,regions:target,optionId});replace(result.products);close();status('已更新 '+result.count+' 个地区价格，等待预览提交');
    }
  }}]);initMulti('priceRegions',regions,regions,'region');const updateScope=()=>{const convert=$('priceKind').value==='convert';$('convertNote').hidden=!convert;$('regionScopeField').hidden=!convert;$('priceRegions').disabled=convert&&$('regionScope').value==='all';};
  $('priceKind').onchange=updateScope;$('regionScope').onchange=updateScope;
}
function changeState(target){
  const products=picked();const options=[...new Set(products.flatMap(p=>p.purchaseOptions.map(o=>o.purchaseOptionId)))];
  modal(target==='ACTIVE'?'批量启用购买选项':'批量停用购买选项','<p class="help">状态变化将加入本地待提交列表。新商品可在同一次提交中先创建，再启用。</p><label class="field">购买选项<select id="stateOption"><option value="">全部购买选项</option>'+options.map(x=>'<option>'+esc(x)+'</option>').join('')+'</select></label>',[{label:'取消',run:close},{label:'加入待提交',class:'primary',run:()=>{
    const oid=$('stateOption').value,next=clone(states);
    for(const p of products)for(const o of p.purchaseOptions)if(!oid||o.purchaseOptionId===oid){
      const prior=old(p.productId)?.purchaseOptions.find(x=>x.purchaseOptionId===o.purchaseOptionId);
      if(target==='INACTIVE'&&!['ACTIVE','INACTIVE'].includes(prior?.state))throw Error(p.productId+' 此选项尚未启用');
      next[p.productId]||={};if(prior?.state===target)delete next[p.productId][o.purchaseOptionId];else next[p.productId][o.purchaseOptionId]=target;
    }
    states=next;persist();render();close();status('状态变化已加入待提交');
  }}]);
}

function encodingField(id){return '<label class="field wide">文件编码<select id="'+id+'"><option value="auto">自动识别（UTF-8 / UTF-16 / 简体中文 GBK）</option><option value="utf-8">UTF-8（推荐多语言文件）</option><option value="gb18030">GBK / GB18030（简体中文 Excel CSV）</option><option value="big5">Big5（繁体中文 CSV）</option><option value="utf-16le">UTF-16 LE</option><option value="utf-16be">UTF-16 BE</option></select></label><p class="help wide" id="'+id+'Hint" role="status">导入预览中请核对文字。多语言文件建议在 Excel 中另存为 CSV UTF-8。</p><div class="file-inspect wide" id="'+id+'Preview" hidden></div>';}
async function readImportFile(file,id){
  const bytes=new Uint8Array(await file.arrayBuffer());let encoding=$(id).value,text;
  if(encoding==='auto'){
    if(bytes[0]===255&&bytes[1]===254)encoding='utf-16le';
    else if(bytes[0]===254&&bytes[1]===255)encoding='utf-16be';
    else {try{text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);encoding='utf-8';}catch{encoding='gb18030';}}
  }
  try{text??=new TextDecoder(encoding,{fatal:true}).decode(bytes);}catch{throw Error('文件无法按 '+encoding+' 解码，请切换文件编码，或从原始表格另存为 CSV UTF-8');}
  if(text.includes('\uFFFD')||text.includes('\u0000'))throw Error('文件中存在损坏字符或编码不匹配，请从原始表格重新导出 CSV UTF-8');
  $(id+'Hint').textContent='本次读取编码：'+encoding+'。请在预览中核对名称和描述；若不正确，请返回切换编码。';
  return text.replace(/^\uFEFF/,'');
}

const isWorkbook=file=>file.name.toLowerCase().endsWith('.xlsx');
async function workbookBase64(file){
  if(file.size>5*1024*1024)throw Error('XLSX 文件超过 5MB，请分批导入');
  return new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result).split(',')[1]);reader.onerror=()=>reject(Error('无法读取工作簿'));reader.readAsDataURL(file);});
}
function bindImportPreview(fileId,encodingId){
  const input=$(fileId),encoding=$(encodingId),box=$(encodingId+'Preview');let revision=0;
  const refresh=async()=>{
    const rev=++revision,file=input.files[0];box.hidden=!file;if(!file)return;
    const workbook=fileId==='languageFile'&&isWorkbook(file);
    encoding.closest('label').hidden=workbook;
    if(workbook)$(encodingId+'Hint').textContent='Excel 工作簿自动读取 Unicode 文本，无需选择 CSV 编码。每个语言页签分别读取。';
    box.textContent='正在读取文件预览…';
    try{
      if(workbook){
        const result=await api('listings/inspect-xlsx',{xlsx:await workbookBase64(file)});
        if(rev!==revision||$(fileId)!==input)return;
        box.innerHTML='<h4>工作簿内容预览</h4><p>'+result.sheets.map(s=>esc(s.name)+'：'+s.filled+' 条，跳过空白 '+s.skipped+' 行').join('；')+'</p><div class="raw-preview">'+result.preview.map(r=>'<div><span>'+esc(r.sheet+' / '+r.row)+'</span><code>'+esc(r.productId+' | '+r.title+' | '+r.description)+'</code></div>').join('')+'</div><p>共 '+result.count+' 条已填写翻译；点击“检查并预览导入”核对变更。</p>';
        return;
      }
      if(file.size>6*1024*1024)throw Error('文件超过 6MB，请分批导入');
      const text=await readImportFile(file,encodingId);
      if(rev!==revision||$(fileId)!==input)return;
      const lines=text.split(/\r\n|\n|\r/);
      box.innerHTML='<h4>文件内容预览 <small>前 '+Math.min(lines.length,8)+' 行</small></h4><div class="raw-preview">'+lines.slice(0,8).map((line,i)=>'<div><span>'+(i+1)+'</span><code>'+esc(line)+'</code></div>').join('')+'</div><p class="inspect-validation">正在检查格式…</p>';
      if(file.name.toLowerCase().endsWith('.json')){JSON.parse(text);box.querySelector('.inspect-validation').textContent='JSON 格式有效；导入时进一步校验商品字段。';}
      else {
        const result=await api('import/inspect',{csv:text});
        if(rev!==revision||$(fileId)!==input)return;
        box.querySelector('.inspect-validation').textContent='CSV 格式有效，共 '+result.count+' 条记录。请确认文字显示正确。';
      }
    }catch(e){if(rev!==revision||$(fileId)!==input)return;const message='<p class="error-box" role="status">'+esc(e.message)+'</p>';if(box.querySelector('.raw-preview'))box.querySelector('.inspect-validation').outerHTML=message;else box.innerHTML=message;}
  };
  input.onchange=refresh;encoding.onchange=refresh;
}
function resultSteps(r){
  const names={check:'提交前核对',configuration:'创建 / 更新',state:'启用 / 停用',readback:'读回核对'},labels={pending:'待完成',skipped:'无需执行',success:'成功',failed:'失败',uncertain:'待核对'};
  return r.steps?'<div class="result-steps">'+Object.entries(r.steps).map(([k,v])=>'<span class="pill '+(v==='success'?'green':v==='failed'||v==='uncertain'?'orange':'')+'">'+esc(names[k]+' · '+labels[v])+'</span>').join('')+'</div>':'';
}
async function recoverResult(logFile){
  const result=await job(()=>api('recover',{mode,logFile}),'正在重新读取远端，仅核对未完成项…');
  modal('未完成项核对结果','<p class="help">本次仅查询远端。应用后将更新这些商品的本地草稿，保留仍需执行的步骤，再生成新的提交预览。</p>'+
    result.entries.map(e=>'<div class="result-row"><b>'+esc(e.after.productId)+'</b><p>'+esc(e.reason)+'</p></div>').join('')+
    result.resolved.map(r=>'<div class="result-row"><b>'+esc(r.productId)+'</b><p>远端已完成，无需重试</p></div>').join('')+
    result.blocked.map(r=>'<div class="error-box"><b>'+esc(r.productId)+'</b><p>'+esc(r.message)+'</p></div>').join(''),
    [{label:'返回',run:close},...(result.entries.length||result.resolved.length?[{label:'应用核对结果并预览',class:'primary',run:async()=>{
      selected.clear();
      for(const r of result.resolved){base=base.filter(p=>p.productId!==r.productId).concat([clone(r.actual)]);draft=draft.filter(p=>p.productId!==r.productId).concat([clone(r.actual)]);delete states[r.productId];}
      for(const e of result.entries){const id=e.after.productId;base=base.filter(p=>p.productId!==id);if(e.before)base.push(clone(e.before));draft=draft.filter(p=>p.productId!==id).concat([clone(e.after)]);states[id]=clone(e.states);selected.add(id);}
      persist();render();if(result.entries.length)await preview(true);else{close();status('远端已完成，已同步本地状态');}
    }}]:[])]);
}
function download(name,text,type){const url=URL.createObjectURL(new Blob([text],{type})),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
function languageDialog(editor=null){
  const scope=clone(editor?editor.products:selected.size?picked():draft);
  if(!scope.length)throw Error('请先读取或创建商品，再下载多语言模板');
  modal('多语言模板导入 · '+scope.length+' 个商品','<p class="help">当前范围：'+(editor?'当前编辑商品 '+esc(scope[0].productId):selected.size?'所选商品':'当前项目的全部商品')+'。每种语言一个 Excel 页签；仅更新名称和描述，未列出的语言、地区和价格均保留。</p><ol class="help"><li>下载 Excel 模板，每种语言单独一个页签，已有名称和描述会自动填入。</li><li>在对应语言页签填写名称和描述，保持语言页签名与三列表头不变，保存为 .xlsx。</li><li>选择文件，检查导入预览后应用到本地草稿。</li></ol><div class="form-grid">'+multiMarkup('templateLanguages','模板中追加的语言（可选，多选）')+'<div class="wide"><button id="downloadLanguages">下载多语言 Excel 模板</button></div><label class="field wide">上传已填写的模板<input id="languageFile" type="file" accept=".xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv"></label>'+encodingField('languageEncoding')+'</div><p class="help">Excel 每页三列：productId / title / description，页签名为语言代码（如 zh-CN）。名称最多 55 字符，描述最多 200 字符。名称和描述均空的行跳过，仅填一项会提示补齐。仍兼容原四列 CSV 模板。同一商品同一语言重复且内容不同会报错。</p>',[
    {label:editor?'返回商品编辑':'取消',run:close},{label:'检查并预览导入',class:'primary',run:async()=>{
      const file=$('languageFile').files[0];if(!file)throw Error('请选择多语言 Excel 或 CSV 模板');
      if(file.size>6*1024*1024)throw Error('文件超过 6MB，请分批导入');
      const payload=isWorkbook(file)?{xlsx:await workbookBase64(file)}:{csv:await readImportFile(file,'languageEncoding')};
      const result=await job(()=>api('listings/import',{mode,...payload,existing:scope}),'正在读取并检查多语言模板…');
      const rows=[];
      for(const p of result.products)for(const l of p.listings){
        const before=scope.find(x=>x.productId===p.productId)?.listings.find(x=>x.languageCode.toLowerCase()===l.languageCode.toLowerCase());
        if(!same(before,l))rows.push({id:p.productId,language:l.languageCode,before,after:l});
      }
      if(!rows.length)throw Error('模板内容与当前草稿一致，没有需要导入的变化');
      modal('多语言导入预览 · '+rows.length+' 条变化','<p class="help">'+(editor?'确认后返回商品表单，请点击保存草稿。':'确认后只更新本地草稿。')+'之后仍需“预览并提交”才会修改 Google 商品。</p><table class="diff-table"><thead><tr><th>商品 / 语言</th><th>修改前</th><th>修改后</th></tr></thead><tbody>'+rows.map(r=>'<tr><td>'+esc(r.id+' / '+r.language)+'</td><td>'+esc(r.before?r.before.title+'\n'+r.before.description:'新增语言')+'</td><td>'+esc(r.after.title+'\n'+r.after.description)+'</td></tr>').join('')+'</tbody></table>',[{label:editor?'返回商品编辑':'取消',run:close},{label:editor?'应用到商品表单':'应用到草稿',class:'primary',run:()=>{if(editor){editor.apply(result.products);status('多语言已应用到表单，请保存草稿');return;}replace(result.products);close();status('已更新 '+result.products.length+' 个商品的 '+rows.length+' 条多语言内容');}}]);
      if(editor)$('modal').returnToEditor=editor.back;
    }}
  ]);
  if(editor)$('modal').returnToEditor=editor.back;
  bindImportPreview('languageFile','languageEncoding');
  initMulti('templateLanguages',LANGUAGE_CODES.concat(scope.flatMap(p=>p.listings.map(l=>l.languageCode))),[],'language');
  bind('downloadLanguages',async()=>{
    const languages=$('templateLanguages').selectedValues();
    const data=await job(()=>api('listings/template',{products:scope,languages,format:'xlsx'},true),'正在生成每种语言一个页签的模板…');
    download('gp-multilingual-template.xlsx',data.blob,'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  });
}
function importDialog(){
  modal('导入 CSV / JSON','<p class="help">CSV 按“商品 ID + 购买选项 + 语言 + 地区”合并，只修改文件中列出的名称、描述和地区价格；其他配置保留。建议先导出现有商品作为模板。JSON 适用于完整商品配置。</p><input id="importFile" type="file" accept=".csv,.json">'+encodingField('importEncoding')+'<p class="help">支持 UTF-8 CSV（包含 BOM）。新商品默认创建购买类型的选项。</p><button id="template">下载单地区 CSV 模板</button> <button id="allRegionTemplate">下载全部地区 CSV 模板</button><div class="warning">全部地区：regionCode 填 ALL，price 填税前基准价，currencyCode 填基准币种，availability 填 AVAILABLE。每个商品可填不同基准价。工具将通过 Google 换算全部地区价格，需要真实授权。同一购买选项不要混用 ALL 与单地区行；需要特殊地区价时，可在导入后另行调整。</div><p id="importProgress" class="help" role="status"></p>',[{label:'取消',run:close},{label:'检查并导入草稿',class:'primary',run:async()=>{
    const f=$('importFile').files[0];if(!f)throw Error('请选择文件');if(f.size>6*1024*1024)throw Error('文件超过 6MB，请分批');
    const text=await readImportFile(f,'importEncoding');let products;
    if(f.name.toLowerCase().endsWith('.json')){
      const data=JSON.parse(text.replace(/^\uFEFF/,''));products=Array.isArray(data)?data:data.products;
      if(!Array.isArray(products)||!products.length)throw Error('JSON 需要商品数组或 {products:[...]}');
      if(products.length>500||new Set(products.map(p=>p.productId)).size!==products.length)throw Error('商品数超过 500 或 ID 重复');
      const pkg=mode==='demo'?'com.example.demo':settings.current.packageName;
      if(products.some(p=>p.packageName!==pkg))throw Error('导入包名须与当前项目一致');
      await job(async()=>{for(const p of products)await api('validate',{product:p});},'检查 JSON 商品…');
    }else{
      $('importProgress').textContent='正在检查 CSV；ALL 行需要连接 Google 获取地区价格，请稍候…';
      try{products=(await job(()=>api('import',{mode,csv:text,existing:draft}),'正在解析 CSV 并换算全部地区价格…')).products;}
      finally{if($('importProgress'))$('importProgress').textContent='';}
    }
    replace(products);close();status('已导入 '+products.length+' 个商品草稿，请预览差异后提交');
  }}]);
  bindImportPreview('importFile','importEncoding');
  bind('template',()=>download('products-template.csv','\uFEFFproductId,purchaseOptionId,languageCode,title,description,regionCode,currencyCode,price,availability\r\ncoins_100,buy,en-US,100 Coins,Get 100 coins,US,USD,0.99,AVAILABLE\r\n','text/csv;charset=utf-8'));
  bind('allRegionTemplate',()=>download('products-all-regions-template.csv','\uFEFFproductId,purchaseOptionId,languageCode,title,description,regionCode,currencyCode,price,availability\r\ncoins_100,buy,en-US,100 Coins,Get 100 coins,ALL,USD,0.99,AVAILABLE\r\n','text/csv;charset=utf-8'));
}
async function exportDialog(){
  const products=selected.size?picked():draft;if(!products.length)throw Error('没有可导出的商品');
  modal('导出 '+products.length+' 个商品','<p>CSV 适合名称、描述、地区价格的批量编辑。完整 JSON 保留高级配置。</p>',[{label:'导出完整 JSON',run:()=>{download('gp-products.json',JSON.stringify(products,null,2),'application/json');close();}},{label:'导出 CSV',class:'primary',run:async()=>{const data=await api('export',{products});download('gp-products.csv',data.csv,'text/csv;charset=utf-8');close();}}]);
}
const fieldNames={listings:'语言',title:'名称',description:'描述',languageCode:'语言代码',purchaseOptions:'购买选项',regionalPricingAndAvailabilityConfigs:'地区',price:'价格',currencyCode:'币种',units:'整数金额',nanos:'小数纳单位',availability:'销售状态',buyOption:'购买设置',state:'启用状态',productId:'商品 ID',packageName:'包名',taxAndComplianceSettings:'税务设置',legacyCompatible:'兼容旧版',multiQuantityEnabled:'多件购买',offerTags:'标签'};
function formatValue(v){if(v===null)return '—';if(typeof v==='object')return JSON.stringify(v);return String(v);}
async function preview(activationChosen=false){
  const products=(selected.size?picked():draft).filter(dirty);
  if(!products.length)throw Error('所选范围内没有待提交变化');
  const newOptions=products.flatMap(p=>p.purchaseOptions.filter(o=>!old(p.productId)?.purchaseOptions.some(x=>x.purchaseOptionId===o.purchaseOptionId)).map(o=>({productId:p.productId,id:o.purchaseOptionId})));
  if(newOptions.length&&!activationChosen){
    modal('新商品提交后的状态','<p>本次包含 <b>'+newOptions.length+' 个新增购买选项</b>，请选择创建后的状态。</p><p class="help">创建并启用：先创建商品，再请求 Google 启用，最后读回核对。仅创建草稿：商品暂不启用。</p>',[
      {label:'返回编辑',run:close},
      {label:'仅创建草稿',run:()=>{for(const o of newOptions)if(states[o.productId])delete states[o.productId][o.id];persist();render();return preview(true);}},
      {label:'创建并启用',class:'primary',run:()=>{for(const o of newOptions){states[o.productId]||={};states[o.productId][o.id]='ACTIVE';}persist();render();return preview(true);}}
    ]);return;
  }
  activePlan=null;
  modal('正在生成预览','<div class="preview-loading" role="status"><span class="spinner"></span><div><strong>正在校验 '+products.length+' 个商品</strong><p>正在检查 Google 当前配置，请稍候。此步骤不会提交商品修改。</p></div></div>');
  let plan;
  try{
    plan=await job(()=>api('preview',{mode,items:products.map(p=>({before:old(p.productId),after:p,states:states[p.productId]||{}}))}),'正在校验商品并检查远端版本…');
  }catch(e){
    status(e.message,true);
    modal('无法生成预览','<div class="error-box" role="alert">'+errorDetails(e.message)+'</div><p class="help">本地草稿已保留，此次未提交商品修改。</p>',[{label:'返回编辑',run:close}]);
    return;
  }
  activePlan=plan;
  modal('提交前预览 · '+plan.entries.length+' 个商品',
    '<div class="warning">'+(mode==='demo'?'演示操作，仅写入本机示例数据。':'即将修改真实 Google Play 商品。')+'<br>目标：'+esc(mode==='demo'?'演示工作区':settings.current.name)+' · <b>'+esc(plan.packageName)+'</b><br>预览有效期 15 分钟。新购买选项按下方状态变更创建或启用；已有启用商品的改价会影响后续购买。</div>'+plan.entries.map(e=>'<section class="preview-item"><h3>'+esc(e.after.productId)+' <span class="pill '+(e.before?'':'orange')+'">'+(e.before?'更新':'创建')+'</span></h3><table class="diff-table"><thead><tr><th>字段</th><th>修改前</th><th>修改后</th></tr></thead><tbody>'+e.changes.map(c=>'<tr><td>'+esc(c.path.split('.').map(x=>fieldNames[x]||x).join(' / '))+'</td><td>'+esc(formatValue(c.before))+'</td><td>'+esc(formatValue(c.after))+'</td></tr>').join('')+'</tbody></table></section>').join('')+'<label class="checkline"><input type="checkbox" id="confirmWrite">我已核对目标项目和上述变更</label>',[
    {label:'返回编辑',run:close},{label:mode==='demo'?'提交演示变更':'提交到 Google Play',class:'primary',run:async()=>{
      if(!$('confirmWrite').checked)throw Error('请先核对并勾选变更确认');
      const result=await job(()=>api('commit',{id:plan.id,mode:plan.mode,packageName:plan.packageName}),'正在提交并逐项读回核对，请勿关闭工具…');
      activePlan=null;
      for(const r of result.results)if(r.status==='verified'){
        base=base.filter(p=>p.productId!==r.productId);base.push(r.actual);
        draft=draft.filter(p=>p.productId!==r.productId);draft.push(clone(r.actual));delete states[r.productId];selected.delete(r.productId);
      }
      persist();render();
      modal('提交结果',result.results.map(r=>'<div class="result-row"><b>'+esc(r.productId)+' <span class="pill '+(r.status==='verified'?'green':'orange')+'">'+esc({verified:'已核对',pending:'等待核对',uncertain:'状态不确定',failed:'未写入'}[r.status])+'</span></b><p>'+esc(r.message)+'</p>'+resultSteps(r)+'</div>').join('')+'<p class="help">本机操作记录：'+esc(result.logFile)+'。失败或待核对商品的草稿已保留。结果不确定时，请先在后台核对，避免直接重复提交。</p>',[...(result.results.some(r=>r.status!=='verified')?[{label:'核对未完成项',run:()=>recoverResult(result.logFile)}]:[]),{label:'关闭',class:'primary',run:close}]);
      status('处理完成：'+result.results.filter(r=>r.status==='verified').length+'/'+result.results.length+' 个商品已读回核对');
    }}]);
  $('confirmWrite').onchange=()=>{
    if(!$('confirmWrite').checked)return;
    const message='请先核对并勾选变更确认';
    if($('modalError')?.dataset.message===message)$('modalError').remove();
    if($('status').textContent===message)status('已确认变更，可点击提交');
  };
}
function discard(){
  const products=picked();modal('撤销所选草稿','<p>撤销 '+products.length+' 个商品的本地修改，未提交的新商品将从草稿中移除。</p>',[{label:'取消',run:close},{label:'撤销草稿',run:()=>{
    const previousDraft=clone(draft),previousStates=clone(states);
    for(const p of products){draft=draft.filter(x=>x.productId!==p.productId);if(old(p.productId))draft.push(clone(old(p.productId)));delete states[p.productId];}
    if(!persist()){draft=previousDraft;states=previousStates;throw Error('无法保存撤销结果，修改仍保留。请先导出 JSON 备份并检查浏览器存储空间。');}
    activePlan=null;selected.clear();render();close();status('已撤销 '+products.length+' 个商品的本地草稿；没有向 Google 提交修改');
  }}]);
}
async function history(){
  const data=await api('history');
  modal('最近操作记录',data.operations.length?data.operations.map((o,i)=>'<section class="preview-item"><h3>'+esc(new Date(o.startedAt).toLocaleString())+' · '+esc(o.mode==='demo'?'演示':'真实')+' · '+esc(o.packageName)+'</h3>'+o.results.map(r=>'<div class="result-row"><b>'+esc(r.productId)+' · '+esc(r.status)+'</b><p>'+esc(r.message)+'</p>'+resultSteps(r)+'</div>').join('')+
    (o.mode===mode&&o.packageName===(mode==='demo'?'com.example.demo':settings.current.packageName)&&o.results.some(r=>r.status!=='verified')?'<button id="recoverHistory'+i+'">核对未完成项</button>':'')+
    '<p class="help">'+esc(o.file)+'</p></section>').join(''):'<p class="help">还没有提交记录。</p>',[{label:'关闭',run:close}]);
  data.operations.forEach((o,i)=>{if($('recoverHistory'+i))bind('recoverHistory'+i,()=>recoverResult(o.file));});
}

function financeDialog(){
  const now=new Date(),previous=new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth()-1,1));
  const year=previous.getUTCFullYear(),month=String(previous.getUTCMonth()+1).padStart(2,'0');
  modal('月度账单导出','<p class="help">下载 Google Earnings 收入报告，保留收入、退款、Google 费用、税费等原始交易行，方便财务核对。</p>'+
    '<div class="warning"><b>账单范围：开发者账号全部应用</b><br>当前项目只用于选择授权和报告地址，原始账单不会按包名过滤。Earnings 报告是交易与收入明细，不是银行到账凭证。</div>'+
    (mode==='demo'?'<p class="error-box">当前为演示模式。请关闭窗口，在首页切换到真实项目后导出账单。</p>':'')+
    '<p>当前授权项目：<b>'+esc(settings.current.name||'未配置')+'</b> · '+esc(settings.current.credentialEmail||'尚未导入服务账号')+'</p>'+
    '<div class="form-grid"><label class="field wide">财务报告 Cloud Storage 地址<input id="financeBucket" value="'+esc(settings.current.financialBucket||'')+'" placeholder="粘贴 gs://pubsite_prod_rev_… 或存储桶名称"></label>'+
    '<label class="field">账单年份<select id="financeYear">'+Array.from({length:now.getUTCFullYear()-2008+1},(_,i)=>now.getUTCFullYear()-i).map(y=>'<option '+(y===year?'selected':'')+'>'+y+'</option>').join('')+'</select></label>'+
    '<label class="field">账单月份<select id="financeMonth">'+Array.from({length:12},(_,i)=>String(i+1).padStart(2,'0')).map(m=>'<option value="'+m+'" '+(m===month?'selected':'')+'>'+Number(m)+' 月</option>').join('')+'</select></label></div>'+
    '<div class="finance-actions"><button id="financeSave">保存报告地址</button><button class="primary" id="financeList">保存地址并读取该月账单</button></div>'+
    '<div id="financeFiles" aria-live="polite"><p class="help">选好月份后读取账单。已有商品管理权限不代表具备财务报告权限。</p></div>'+
    '<details class="auth-guide"><summary>首次配置与权限说明</summary><ol><li>打开 Play Console → 下载报告 → 财务，找到收入报告（Earnings）。</li><li>点击该栏目旁的“复制 Cloud Storage URI”，粘贴到上方并保存。通常以 <code>gs://pubsite_prod_rev_</code> 开头。</li><li>在 Play Console 用户和权限中选择当前服务账号：在账号级范围授予查看应用信息/下载批量报告，以及查看财务数据的全局权限。仅授予某个应用的权限可能无法下载账号账单。</li><li>可复用项目中已保存的服务账号 JSON；由管理员补充财务只读权限后重新读取。这里不需要授予退款操作权限。</li></ol><p>报告按 Google 月份下载，可能延迟发布或存在补充调整文件。请核对同月所有文件；原始 ZIP 内的 CSV 通常为 UTF-16，可用 Excel 打开。工具不改写金额、不跨币种汇总。</p><a href="https://support.google.com/googleplay/android-developer/answer/6135870?hl=zh-Hans" target="_blank" rel="noreferrer">Google 官方财务报告与权限说明 ↗</a></details>',
    [{label:'关闭',run:close}]);
  let lastList=null;
  const financeJob=async(fn,message)=>{const fields=['financeBucket','financeYear','financeMonth'].map($);fields.forEach(el=>el.disabled=true);try{return await job(fn,message);}finally{fields.forEach(el=>el.disabled=false);}};

  const clear=()=>{lastList=null;$('financeFiles').innerHTML='<p class="help">配置或月份已改变，请重新读取账单。</p>';};
  $('financeBucket').oninput=clear;$('financeYear').onchange=clear;$('financeMonth').onchange=clear;
  const saveConfig=async()=>{
    if(mode!=='live')throw Error('请先切换到真实项目');
    settings=await api('finance/config',{mode,bucket:$('financeBucket').value});
    $('financeBucket').value=settings.current.financialBucket;renderHeader();
  };
  bind('financeSave',async()=>{await financeJob(saveConfig,'正在保存报告地址…');clear();status('财务报告地址已保存到当前项目');});
  bind('financeList',async()=>{
    $('financeFiles').innerHTML='<p class="help">正在读取该月收入报告…</p>';
    try{
      const result=await financeJob(async()=>{await saveConfig();return api('finance/list',{mode,month:$('financeYear').value+'-'+$('financeMonth').value});},'正在读取 Google 月度收入报告…');
      lastList=result;
      $('financeFiles').innerHTML=result.files.length?'<p class="help">'+esc(result.month)+' · 共 '+result.files.length+' 个文件 · 开发者账号全部应用。请同时核对补充调整文件。</p><div class="finance-table"><table><thead><tr><th>原始文件</th><th>大小</th><th>更新时间</th><th></th></tr></thead><tbody>'+result.files.map((f,i)=>'<tr><td>'+esc(f.name)+'<small>版本 '+esc(f.generation)+'</small></td><td>'+esc((Number(f.size)/1024/1024).toFixed(2))+' MB</td><td>'+esc(f.updated?new Date(f.updated).toLocaleString():'—')+'</td><td><button id="financeDownload'+i+'">下载原始账单</button></td></tr>').join('')+'</tbody></table></div>':'<p class="help">该月没有可下载的收入报告。可能尚未发布、该月无报告或地址不匹配；请核对月份和报告地址。</p>';
      result.files.forEach((f,i)=>bind('financeDownload'+i,async()=>{
        if(lastList!==result)throw Error('列表已变化，请重新读取');
        const data=await financeJob(()=>api('finance/download',{mode,reportId:f.id},true),'正在下载并核对原始账单，请稍候…');
        const url=URL.createObjectURL(data.blob),a=document.createElement('a');a.href=url;a.download=f.name;a.click();setTimeout(()=>URL.revokeObjectURL(url),60000);
        status('已导出 '+f.name+'（开发者账号全部应用）');
      }));
      status('已读取 '+result.files.length+' 个账单文件');
    }catch(e){lastList=null;$('financeFiles').innerHTML='<p class="help">账单读取未完成，请按错误说明处理后重试。</p>';throw e;}
  });
}



const reviewLabels={DRAFT:'草稿',NOT_SENT_FOR_REVIEW:'待送审',IN_REVIEW:'审核中',APPROVED_NOT_PUBLISHED:'通过待发布',NOT_APPROVED:'审核未通过',PUBLISHED:'已发布',UNSPECIFIED:'未知状态'};
const reviewLabel=state=>reviewLabels[String(state).replace(/^RELEASE_LIFECYCLE_STATE_/,'')]||'未知状态（'+state+'）';
const reviewTime=value=>value?new Date(value).toLocaleString():'尚未检查';

const feishuText=text=>esc(String(text).replaceAll('<at user_id="all">所有人</at>','@全体成员'));
const REVIEW_PROJECT_KEY='gp-review-project-v1';
let reviewProjectId='';
async function feishuDialog(profileId=reviewProjectId){
  const profile=settings.profiles.find(p=>p.id===profileId);
  if(!profile)throw Error('审核监控项目不存在，请重新选择');
  const state=await job(()=>api('monitor/feishu/status',{mode:'live',profileId}),'正在读取飞书通知配置…');
  modal('飞书群通知 · '+profile.name,'<p>为当前项目配置群机器人。启用后仅发送新检测到的状态变化；首次审核查询建立基线，不补发历史状态。</p><div class="form-grid">'+
    '<label class="checkline wide"><input type="checkbox" id="feishuEnabled" '+(state.enabled?'checked':'')+'>启用飞书自动通知</label>'+
    '<label class="field wide">机器人 Webhook<input id="feishuWebhook" type="password" autocomplete="new-password" placeholder="'+(state.hasWebhook?'已加密保存，留空保留；填写新地址可替换':'https://open.feishu.cn/open-apis/bot/v2/hook/…')+'"></label>'+
    '<label class="field wide">签名校验密钥（可选）<input id="feishuSecret" type="password" autocomplete="new-password" placeholder="'+(state.hasSecret?'已保存，留空保留':'机器人开启签名校验时填写')+'"></label>'+
    '<label class="checkline wide"><input id="feishuClearSecret" type="checkbox">清除已保存的签名密钥（机器人关闭签名时使用）</label>'+
    '<fieldset class="wide"><legend>通知时机</legend><label class="checkline"><input id="feishuApproved" type="checkbox" '+(state.states.includes('RELEASE_LIFECYCLE_STATE_APPROVED_NOT_PUBLISHED')?'checked':'')+'>审核通过，等待发布</label><label class="checkline"><input id="feishuPublished" type="checkbox" '+(state.states.includes('RELEASE_LIFECYCLE_STATE_PUBLISHED')?'checked':'')+'>已经发布</label></fieldset>'+
    '<label class="checkline wide"><input id="feishuMentionAll" type="checkbox" '+(state.mentionAll?'checked':'')+'>通知时 @全体成员</label></div>'+
    '<p class="help">@全体成员默认关闭，按项目保存。开启后，自动通知和测试通知都会提醒全体成员；群内需允许机器人 @所有人。测试使用已保存设置；重试保留原消息的 @ 提醒。</p>'+
    '<p class="help">本机加密保存 Webhook 和密钥，不回显。启用通知也需要在上一页启用审核监控，并保持本机后台服务运行。</p>'+
    '<details><summary>如何准备飞书机器人？</summary><ol><li>在接收通知的飞书群中打开“设置 → 群机器人 → 添加机器人 → 自定义机器人”。</li><li>复制 Webhook 到上方；若开启签名校验，一并填写签名密钥。</li><li>若使用关键词限制，添加关键词 PlayBatch。若使用 IP 白名单，需允许本机网络的出口 IP。</li><li>保存后点击测试通知，在群里确认收到。</li></ol><p><a href="https://open.feishu.cn/document/client-docs/bot-v3/add-custom-bot" target="_blank" rel="noreferrer">飞书官方配置指南 ↗</a></p></details>'+
    '<div class="finance-actions"><button id="feishuSave">保存通知设置</button><button id="feishuTest">发送测试通知到群</button></div><div id="feishuResults"></div>',
    [{label:'返回审核监控',run:()=>reviewMonitorDialog(profileId)},{label:'关闭',run:close}]);
  const draw=s=>{
    const names={pending:'待发送',sending:'发送中',sent:'已发送',failed:'发送失败',uncertain:'结果不明'};
    $('feishuResults').innerHTML='<h3>最近通知</h3>'+(s.deliveries.length?s.deliveries.map((d,i)=>'<div class="result-row"><b>'+esc((d.kind==='test'?'测试通知':'审核通知')+' · '+names[d.status]+' · '+reviewTime(d.sentAt||d.at))+'</b><p style="white-space:pre-wrap">'+feishuText(d.text)+'</p>'+(d.error?'<p class="error-box">'+esc(d.error)+'</p>':'')+(['failed','uncertain'].includes(d.status)?'<button id="feishuRetry'+i+'">查看重试</button>':'')+'</div>').join(''):'<p class="help">暂无发送记录。</p>');
    s.deliveries.forEach((d,i)=>{if(['failed','uncertain'].includes(d.status))bind('feishuRetry'+i,()=>modal('重试这条通知？','<p>此操作会发送到当前保存的飞书群。若之前显示“结果不明”，请先查看群消息，重试可能造成重复。</p><pre style="white-space:pre-wrap">'+feishuText(d.text)+'</pre>',[{label:'返回',run:()=>feishuDialog(profileId)},{label:'确认重试发送',class:'primary',run:async()=>{await job(()=>api('monitor/feishu/retry',{mode:'live',profileId,id:d.id}),'正在重试发送…');await feishuDialog(profileId);}}]));});
  };
  draw(state);
  bind('feishuSave',async()=>{
    const states=[];if($('feishuApproved').checked)states.push('RELEASE_LIFECYCLE_STATE_APPROVED_NOT_PUBLISHED');if($('feishuPublished').checked)states.push('RELEASE_LIFECYCLE_STATE_PUBLISHED');
    const payload={mode:'live',profileId,enabled:$('feishuEnabled').checked,mentionAll:$('feishuMentionAll').checked,states,webhook:$('feishuWebhook').value.trim(),secret:$('feishuSecret').value.trim(),clearSecret:$('feishuClearSecret').checked};
    const result=await job(()=>api('monitor/feishu/config',payload),'正在加密保存通知设置…');
    $('feishuWebhook').value='';$('feishuSecret').value='';$('feishuClearSecret').checked=false;
    $('feishuWebhook').placeholder=result.hasWebhook?'已加密保存，留空保留':'请输入 Webhook';$('feishuSecret').placeholder=result.hasSecret?'已保存，留空保留':'可选签名密钥';draw(result);status('飞书通知设置已保存');
  });
  bind('feishuTest',async()=>{const result=await job(()=>api('monitor/feishu/test',{mode:'live',profileId}),'正在向已保存的飞书群发送测试通知…');draw(result);status(result.deliveries[0]?.status==='sent'?'测试通知已发送，请查看飞书群':'测试未确认成功，请查看发送记录',result.deliveries[0]?.status!=='sent');});
}

async function reviewMonitorDialog(requestedId){
  let remembered=reviewProjectId;try{remembered=remembered||localStorage.getItem(REVIEW_PROJECT_KEY);}catch{}
  const profile=settings.profiles.find(p=>p.id===(requestedId||remembered))||settings.profiles[0];
  if(!profile){modal('应用审核监控','<p>暂无项目，请先通过“新增项目”配置包名和服务账号。</p>',[{label:'关闭',run:close}]);return;}
  const profileId=profile.id;
  const state=await job(()=>api('monitor/status',{mode:'live',profileId}),'正在读取审核监控配置…');
  reviewProjectId=profileId;try{localStorage.setItem(REVIEW_PROJECT_KEY,profileId);}catch{}
  const choices=[...new Set(['production','internal','alpha','beta',...state.tracks])];
  modal('应用审核监控 · '+profile.name,'<label class="field">监控项目<select id="reviewProject">'+settings.profiles.map(p=>'<option value="'+esc(p.id)+'" '+(p.id===profileId?'selected':'')+'>'+esc(p.name+' · '+p.packageName)+'</option>').join('')+'</select></label><p class="help">审核监控独立选择项目，不影响商品页及其草稿。</p><p>监控应用版本：审核中、通过待发布、审核未通过、已发布。首次检查建立基线，后续变化会记录并显示在侧栏。</p><p class="help">本机后台服务运行时持续检查，关闭浏览器也会检查；停止工具或电脑休眠期间暂停。这里不会自动提交审核或发布版本。</p>'+
    '<div class="form-grid"><label class="checkline wide"><input id="reviewEnabled" type="checkbox" '+(state.enabled?'checked':'')+'>启用此项目的后台监控</label><label class="field">检查间隔<select id="reviewInterval">'+[5,15,30,60].map(n=>'<option value="'+n+'" '+(state.intervalMinutes===n?'selected':'')+'>'+n+' 分钟</option>').join('')+'</select></label>'+multiMarkup('reviewTracks','发布轨道')+
    '<details class="wide"><summary>自定义封闭测试轨道</summary><p class="help">如使用自定义轨道，填写 Play Console 中的轨道 ID 并添加。</p><input id="reviewCustomTrack" aria-label="自定义轨道 ID"><button id="reviewAddTrack">添加轨道</button></details></div>'+
    '<div class="finance-actions"><button id="reviewSave">保存监控设置</button><button id="reviewCheck" class="primary">保存并立即检查</button><button id="reviewRead">标记已读</button><button id="reviewFeishu">飞书通知</button></div><div id="reviewResults"></div><p class="help">“已发布”不等于全量发布，也可能是分阶段或暂停后可恢复的版本。无返回结果或版本从列表消失不代表被拒绝。</p><p><a href="https://play.google.com/console" target="_blank" rel="noreferrer">打开 Play Console ↗</a></p>',
    [{label:'关闭',run:close}]);
  initMulti('reviewTracks',choices,state.tracks,null);
  const readForm=()=>JSON.stringify([$('reviewEnabled').checked,$('reviewInterval').value,$('reviewTracks').selectedValues()]);
  let savedForm=readForm();
  $('reviewProject').onchange=async e=>{const next=e.target.value;e.target.value=profileId;if(working)return;if(readForm()!==savedForm&&!confirm('监控设置尚未保存，切换项目会放弃这些修改。继续吗？'))return;try{await reviewMonitorDialog(next);}catch(error){showError(error.message);}};
  const draw=result=>{
    $('reviewResults').innerHTML='<p>上次成功检查：'+esc(reviewTime(result.lastCheck))+' · 后台监控：'+(result.enabled?'已开启':'已关闭')+'</p>'+
      (result.quotaUntil>Date.now()?'<p class="warning">配额冷却中，下次允许查询：'+esc(reviewTime(result.quotaUntil))+'。冷却期间点击检查不会再次请求 Google；这是工具的重试时间，不保证 Google 配额届时恢复。</p>':'')+
      (result.error?'<p class="error-box">本次检查失败：'+esc(result.error)+'<br>下方保留上次成功结果。</p>':'')+
      '<div class="finance-table"><table><thead><tr><th>轨道 / 版本</th><th>版本号</th><th>状态</th></tr></thead><tbody>'+result.snapshot.map(r=>'<tr><td>'+esc(r.track+' / '+r.name)+'</td><td>'+esc(r.versionCodes.join(', '))+'</td><td>'+esc(reviewLabel(r.state))+'</td></tr>').join('')+'</tbody></table></div>'+
      (!result.snapshot.length?'<p class="help">'+(result.lastCheck?'所选轨道未返回当前版本；不代表审核通过或拒绝。':'尚未读取 Google，请点击立即检查。')+'</p>':'')+
      '<h3>最近状态变化</h3>'+result.events.map(e=>'<p>'+esc(reviewTime(e.at)+' · '+e.track+' / '+e.name+' ['+e.versionCodes.join(', ')+']：'+(e.before?reviewLabel(e.before):'新版本')+' → '+reviewLabel(e.after))+'</p>').join('')+
      (!result.events.length?'<p class="help">暂无变化记录。首次读取仅建立基线。</p>':'');
  };
  draw(state);
  bind('reviewAddTrack',()=>{const value=$('reviewCustomTrack').value.trim();if(!value||value.length>100||/[\/\\\x00-\x1f]/.test(value))throw Error('请输入有效的轨道 ID');const selected=$('reviewTracks').selectedValues();if(!choices.includes(value))choices.push(value);initMulti('reviewTracks',choices,[...selected,value],null);$('reviewCustomTrack').value='';});
  const saveReview=async()=>{const result=await api('monitor/config',{mode:'live',profileId,enabled:$('reviewEnabled').checked,intervalMinutes:Number($('reviewInterval').value),tracks:$('reviewTracks').selectedValues()});savedForm=readForm();return result;};
  bind('reviewSave',async()=>{const result=await job(saveReview,'正在保存监控设置…');draw(result);status(result.enabled?'后台审核监控已开启':'后台审核监控已关闭');});
  bind('reviewCheck',async()=>{const result=await job(async()=>{await saveReview();return api('monitor/check',{mode:'live',profileId});},'正在查询 Google 审核与发布状态…');draw(result);status(result.error?'检查未成功，详情见窗口':'审核状态已更新',!!result.error);await refreshReviewBadge();});
  bind('reviewFeishu',()=>feishuDialog(profileId));
  bind('reviewRead',async()=>{draw(await api('monitor/acknowledge',{mode:'live',profileId}));await refreshReviewBadge();});
}
async function refreshReviewBadge(){
  if(working)return;
  try{const result=await api('monitor/summary');const count=result.projects.reduce((n,p)=>n+p.unread,0);$('reviewBadge').textContent=count?' · '+count:'';$('reviewMonitor').title=result.projects.filter(p=>p.unread).map(p=>p.name+'：'+p.unread+' 条状态变化').join('\n');}catch{}
}

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
    '<h3>快捷入口</h3><p>在桌面和开始菜单创建 PlayBatch 快捷方式。更新后仍可从同一个入口打开。</p>'+
    '<h3>诊断信息</h3><p>导出版本、运行状态、更新阶段和日志中的错误类型，便于排查。文件不包含私钥、令牌、项目内容或原始日志。</p>',[
    {label:'关闭',run:close},...(info.desktop.supported?[{label:'创建/修复快捷方式',run:async()=>{await api('system/shortcuts');status('桌面和开始菜单快捷方式已创建');close();}}]:[]),
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
    modal('检查更新未完成','<p class="error-box">'+esc(message)+'</p><p><a href="https://github.com/qiaoxuelin/gp-product-workbench/releases/latest" target="_blank" rel="noreferrer">打开 GitHub 下载页 ↗</a></p>',[{label:'关闭',run:close},{label:'重试',run:updateDialog}]);return;
  }
  modal('检查更新','<p>当前版本：<b>'+esc(release.currentVersion)+'</b>　最新版本：<b>'+esc(release.version)+'</b></p>'+
    '<p>'+(release.available?'发现新版本。':'当前已是最新版本，或正在使用更高版本。')+'</p>'+
    (release.supported?'<p>检查后可直接下载、校验、安装并重启，无需另开 GitHub。项目、授权和已保存草稿保留，原启动入口仍可用。源码启动时会安装独立发布版并切换，源码文件保留。</p>':'<p class="warning">此运行环境不支持自动安装。请前往下载页获取 Windows 免安装包。</p>')+
    '<p><a href="'+esc(release.page)+'" target="_blank" rel="noreferrer">打开 GitHub 下载页 ↗</a></p><details><summary>查看发布说明</summary><pre style="white-space:pre-wrap;overflow-wrap:anywhere">'+esc(release.notes)+'</pre></details>',
    [{label:'关闭',run:close},...(release.available&&release.supported?[{label:'更新并重启',class:'primary',run:()=>installUpdate(release.version)}]:[])]);
}
async function installUpdate(version){
  // Abort if draft persistence fails; do not silently restart with unsaved browser data.
  localStorage.setItem(key(),JSON.stringify({base,draft,states}));
  await job(()=>api('update/start',{version}),'正在启动更新…');
  modal('正在更新','<p id="updateProgress" role="status">正在准备下载，请保持页面打开…</p>',[]);
  working=true;document.querySelectorAll('button').forEach(b=>b.disabled=true);$('mode').disabled=true;$('project').disabled=true;
  const started=Date.now();
  const poll=async()=>{
    try{
      const state=await api('update/status');
      if(state.phase==='complete'&&!state.locked&&state.currentVersion===version){
        location.reload();return;
      }
      if(state.phase==='failed'){
        working=false;document.querySelectorAll('button').forEach(b=>b.disabled=false);$('mode').disabled=false;$('project').disabled=false;syncActions();
        modal('更新未完成','<p class="error-box">'+esc(state.message)+'</p><p>当前版本：'+esc(state.currentVersion||'待确认')+'。可导出诊断信息排查；若服务未启动，请双击原来的“启动工具.cmd”。</p><a href="https://github.com/qiaoxuelin/gp-product-workbench/releases/latest" target="_blank" rel="noreferrer">前往 GitHub 手动下载</a>',[{label:'关闭',run:close},{label:'导出诊断信息',run:exportDiagnostics},{label:'重新检查',run:updateDialog}]);return;
      }
      $('updateProgress').textContent=state.phase==='downloading'?'正在下载：'+Math.floor((state.received||0)/state.total*100)+'%':state.phase==='checking'?'正在核对最新版本…':state.phase==='installing'?'正在安装 '+version+' 并重启，请稍候…':'正在确认 '+version+' 的运行状态…';
    }catch{$('updateProgress').textContent='正在等待工具重启…';}
    if(Date.now()-started>10*60*1000){
      working=false;document.querySelectorAll('button').forEach(b=>b.disabled=false);$('mode').disabled=false;$('project').disabled=false;syncActions();
      modal('更新状态待确认','<p>等待重启超时。可先重新读取运行状态或导出诊断信息。若服务无法连接，请双击原来的“启动工具.cmd”再刷新页面。</p>',[{label:'关闭',run:close},{label:'导出诊断信息',run:exportDiagnostics},{label:'查看运行状态',run:supportDialog}]);return;
    }
    setTimeout(poll,1200);
  };
  setTimeout(poll,500);
}

async function init(){
  const session=await(await fetch('/api/session')).json();token=session.token;$('appVersion').textContent='PlayBatch v'+(session.version||'未知');
  bind('about',()=>modal('关于 PlayBatch','<h3>Google Play 商品工作台</h3><p>由 <a href="https://github.com/qiaoxuelin" target="_blank" rel="noreferrer">qiaoxuelin</a> 开发</p><p>当前版本：'+esc(session.version||'未知')+'</p><p>一次性商品批量创建、地区改价、多语言与状态管理。</p><p><a href="https://github.com/qiaoxuelin/gp-product-workbench/releases/latest" target="_blank" rel="noreferrer">查看新版与更新说明 ↗</a></p>',[{label:'关闭',run:close}]));settings=await api('config');await restoreVisit();restore();
  bind('reviewMonitor',reviewMonitorDialog);bind('update',updateDialog);bind('finance',financeDialog);bind('support',supportDialog);
  bind('newProject',()=>openSettings(''));bind('settings',()=>openSettings());bind('refresh',refresh);bind('create',newProduct);bind('copy',copyProducts);bind('price',priceDialog);bind('import',importDialog);bind('languages',languageDialog);bind('export',exportDialog);bind('preview',preview);bind('activate',()=>changeState('ACTIVE'));bind('deactivate',()=>changeState('INACTIVE'));bind('discard',discard);bind('history',history);bind('closeModal',close);
  $('modal').addEventListener('cancel',e=>{if(working)e.preventDefault();else if($('modal').returnToEditor){e.preventDefault();close();}});
  document.querySelectorAll('[data-filter]').forEach(b=>b.onclick=()=>{catalogFilter=b.dataset.filter;render();});
  $('productStateFilter').onchange=e=>{productStateFilter=e.target.value;render();};
  bind('resetFilters',()=>{productStateFilter='all';$('productStateFilter').value='all';catalogFilter='all';search='';$('search').value='';render();});
  bind('clearSelection',()=>{selected.clear();render();});
  $('search').oninput=e=>{search=e.target.value;render();};
  $('selectAll').onchange=e=>{visibleProducts().forEach(p=>e.target.checked?selected.add(p.productId):selected.delete(p.productId));render();};
  $('mode').onchange=async()=>{if(working)return;persist();mode=$('mode').value;restore();status('已切换工作区');if(mode==='demo'&&!draft.length){try{await loadProducts();}catch(e){showError(e.message);}}};
  $('project').onchange=async()=>{if(working)return;try{persist();settings=await api('config/switch',{id:$('project').value});restore();status('已切换到 '+settings.current.name+'；点击读取商品加载此项目');}catch(e){showError(e.message);render();}};
  if(!draft.length)await loadProducts();else status('已恢复本机草稿');
  await refreshReviewBadge();setInterval(refreshReviewBadge,30000);
  try{await showUpdateOutcome(session.version);}catch{}
}
init().catch(e=>showError(e.message));
