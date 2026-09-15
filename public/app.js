'use strict';
const $=id=>document.getElementById(id), esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const clone=v=>structuredClone(v), same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
let token='', settings={profiles:[],activeId:'',current:{}}, mode='demo',base=[],draft=[],states={},selected=new Set(),search='',activePlan=null,working=false;
const key=()=> 'gp-workspace-v1:'+mode+':'+(mode==='demo'?'demo':settings.activeId+':'+settings.current.packageName);
const old=id=>base.find(p=>p.productId===id)||null;
const dirty=p=>!same(p,old(p.productId))||Object.keys(states[p.productId]||{}).length>0;
function status(message,error=false){$('status').textContent=message;$('status').className=error?'error':'';}
async function api(url,body={}){
  // Freeze the target and payload across a retry; only a request rejected before routing is retried.
  const payload=JSON.stringify({...body,...(body.mode==='live'?{profileId:settings.activeId}:{})});
  for(let attempt=0;attempt<2;attempt++){
    const r=await fetch('/api/'+url,{method:'POST',headers:{'Content-Type':'application/json','X-GP-Token':token},body:payload});
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
    root.querySelectorAll('input[type=checkbox]').forEach(el=>el.onchange=()=>{el.checked?chosen.add(el.value):chosen.delete(el.value);draw();});
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
  box.innerHTML=errorDetails(message);box.scrollIntoView({block:'nearest'});
}
async function job(fn,message){working=true;status(message||'处理中…');const buttons=[...document.querySelectorAll('button')];buttons.forEach(b=>b.disabled=true);$('mode').disabled=true;$('project').disabled=true;
  try{return await fn();}finally{working=false;buttons.forEach(b=>b.disabled=false);$('mode').disabled=false;renderHeader();}}
function persist(){try{localStorage.setItem(key(),JSON.stringify({base,draft,states}));}catch{status('本机草稿保存失败，请导出 JSON 备份后继续',true);}}
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
  bind('connectLink',()=>openSettings());
}
function render(){
  renderHeader();const list=draft.filter(p=>(p.productId+' '+p.listings.map(l=>l.title).join(' ')).toLowerCase().includes(search));
  $('total').textContent=draft.length;$('selectedCount').textContent=selected.size;
  const count=draft.filter(dirty).length;$('dirtyCount').textContent=count;$('pendingBadge').textContent=count;
  $('selectionHint').textContent=selected.size?'已选择 '+selected.size+' 个商品':'选择商品后执行批量操作';
  $('products').innerHTML=list.map(p=>{
    const o=p.purchaseOptions[0],price=o?.regionalPricingAndAvailabilityConfigs||[],allStates=[...new Set(p.purchaseOptions.map(x=>states[p.productId]?.[x.purchaseOptionId]||x.state||'DRAFT'))],s=allStates.length===1?allStates[0]:'MIXED';
    return '<tr class="'+(selected.has(p.productId)?'selected':'')+'"><td><input type="checkbox" aria-label="选择 '+esc(p.productId)+'" data-select="'+esc(p.productId)+'" '+(selected.has(p.productId)?'checked':'')+'></td><td><strong>'+esc(p.listings[0]?.title||p.productId)+'</strong><small>'+esc(p.productId)+'</small></td><td><span class="pill">'+p.purchaseOptions.length+' 个选项</span><small>'+esc(o?.purchaseOptionId||'')+' · '+p.listings.length+' 种语言</small></td><td>'+price.slice(0,2).map(r=>'<div class="price-line"><span>'+esc(r.regionCode)+'</span>'+esc(r.price?.currencyCode)+' '+esc(decimal(r.price))+'</div>').join('')+(price.length>2?'<small>共 '+price.length+' 个地区</small>':'')+'</td><td><span class="pill '+(s==='ACTIVE'?'green':'')+'">'+esc(({ACTIVE:'已启用',DRAFT:'草稿',INACTIVE:'已停用',INACTIVE_PUBLISHED:'已停用 · 兼容',MIXED:'多种状态'}[s]||s))+'</span></td><td>'+(dirty(p)?'<span class="pill orange">'+(old(p.productId)?'待更新':'待创建')+'</span>':'<span class="pill">已同步</span>')+'</td><td><button data-edit="'+esc(p.productId)+'">编辑</button></td></tr>';
  }).join('');
  $('empty').hidden=list.length>0;
  $('selectAll').checked=list.length>0&&list.every(p=>selected.has(p.productId));
  $('selectAll').indeterminate=list.some(p=>selected.has(p.productId))&&!$('selectAll').checked;
  document.querySelectorAll('[data-select]').forEach(el=>el.onchange=()=>{el.checked?selected.add(el.dataset.select):selected.delete(el.dataset.select);render();});
  document.querySelectorAll('[data-edit]').forEach(el=>el.onclick=()=>edit(clone(draft.find(p=>p.productId===el.dataset.edit))));
}
function decimal(m){return m?String(m.units||'0')+(m.nanos?'.'+String(m.nanos).padStart(9,'0').replace(/0+$/,''):''):'';}
function makeMoney(value,currency){const s=String(value).trim();if(!/^\d+(\.\d{1,9})?$/.test(s))throw Error('价格格式错误');const [u,f='']=s.split('.');return {currencyCode:currency.toUpperCase(),units:String(BigInt(u)),nanos:Number(f.padEnd(9,'0'))};}
function modal(title,body,actions=[]){
  $('dialogTitle').textContent=title;$('dialogBody').innerHTML=body;$('dialogActions').innerHTML='';
  for(const a of actions){const b=document.createElement('button');b.textContent=a.label;b.className=a.class||'';b.onclick=async()=>{if(working)return;try{await a.run();}catch(e){showError(e.message);}};$('dialogActions').append(b);}
  if(!$('modal').open)$('modal').showModal();$('dialogBody').scrollTop=0;
}
function close(){if(!working)$('modal').close();}
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
    selected.clear();persist();render();status('已读取 '+data.products.length+' 个商品'+(rebase?'；未提交草稿已保留':''));
  },'正在读取全部商品…');
}
function refresh(){
  if(draft.some(dirty)){modal('刷新商品', '<p>当前有未提交草稿。保留草稿会保留它们原来的版本依据，提交时仍检查远端冲突。</p>',[
    {label:'取消',run:close},{label:'放弃草稿并重新读取',run:async()=>{close();await loadProducts();}},
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
      '<div class="section-title">多语言名称与描述 <button id="addLocale">＋ 添加语言</button></div><div class="help">语言代码 / 名称（最多 55 字符）/ 描述（最多 200 字符）</div><div id="locales">'+p.listings.map((l,i)=>'<div class="edit-row locale-row"><select aria-label="语言代码" data-l="'+i+'" data-k="languageCode">'+choiceOptions(LANGUAGE_CODES,l.languageCode,'language','请选择语言')+'</select><input aria-label="商品名称" data-l="'+i+'" data-k="title" value="'+esc(l.title)+'"><textarea aria-label="商品描述" data-l="'+i+'" data-k="description">'+esc(l.description)+'</textarea><button data-del-l="'+i+'" aria-label="删除语言">×</button></div>').join('')+'</div>'+
      '<div class="section-title">购买选项与地区价格 <button id="addOption">＋ 添加购买选项</button></div>'+p.purchaseOptions.map((o,i)=>'<section class="option-box"><div class="option-head"><b>选项</b><input type="text" aria-label="购买选项 ID" data-oid="'+i+'" value="'+esc(o.purchaseOptionId)+'" '+(old(originalId)?.purchaseOptions.some(x=>x.purchaseOptionId===o.purchaseOptionId)?'readonly':'')+'><span class="pill">'+esc(o.state||'DRAFT')+'</span>'+(o.buyOption?'<label><input type="checkbox" data-legacy="'+i+'" '+(o.buyOption.legacyCompatible?'checked':'')+'>兼容旧版 Billing</label><label><input type="checkbox" data-multi="'+i+'" '+(o.buyOption.multiQuantityEnabled?'checked':'')+'>允许多件购买</label>':'<span>租赁选项 · 在高级 JSON 中编辑租期</span>')+'</div><div class="help">地区 / 币种 / 价格 / 销售状态</div>'+o.regionalPricingAndAvailabilityConfigs.map((r,j)=>'<div class="edit-row region-row"><select aria-label="地区代码" data-o="'+i+'" data-r="'+j+'" data-k="regionCode">'+choiceOptions(REGION_CODES,r.regionCode,'region')+'</select><select aria-label="币种" data-o="'+i+'" data-r="'+j+'" data-k="currencyCode">'+choiceOptions(currencyCodes(),r.price?.currencyCode,'currency')+'</select><input aria-label="地区价格" data-o="'+i+'" data-r="'+j+'" data-k="price" value="'+esc(decimal(r.price))+'"><select aria-label="地区销售状态" data-o="'+i+'" data-r="'+j+'" data-k="availability">'+['AVAILABLE','NO_LONGER_AVAILABLE','AVAILABLE_IF_RELEASED','AVAILABLE_FOR_OFFERS_ONLY'].map(a=>'<option '+(r.availability===a?'selected':'')+' value="'+a+'">'+({AVAILABLE:'可销售',NO_LONGER_AVAILABLE:'停止销售',AVAILABLE_IF_RELEASED:'预购发布后可售',AVAILABLE_FOR_OFFERS_ONLY:'仅优惠可售'}[a])+'</option>').join('')+'</select><button data-del-r="'+i+','+j+'" aria-label="移除地区行">×</button></div>').join('')+'<button data-add-r="'+i+'">＋ 添加地区</button></section>').join('')+
      '<p class="help">修改只保存为本地草稿。已有购买选项的启用/停用请使用列表中的批量操作。</p><details><summary>高级字段（标签、税务、租赁、新地区规则等）</summary><p class="help">JSON 编辑保留已有字段；商品图标和促销优惠不在本版编辑范围。</p><button id="advanced">打开完整 JSON 编辑器</button></details>',[
      {label:'取消',run:close},{label:'保存草稿',class:'primary',run:async()=>{pull();if(isNew&&draft.some(x=>x.productId===p.productId))throw Error('商品 ID 已存在');await api('validate',{product:p});replace([p]);close();status('商品已保存为本地草稿');}}]);
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
  modal(target==='ACTIVE'?'批量启用购买选项':'批量停用购买选项','<p class="help">状态变化将加入本地待提交列表。新商品须先创建，再启用。</p><label class="field">购买选项<select id="stateOption"><option value="">全部购买选项</option>'+options.map(x=>'<option>'+esc(x)+'</option>').join('')+'</select></label>',[{label:'取消',run:close},{label:'加入待提交',class:'primary',run:()=>{
    const oid=$('stateOption').value,next=clone(states);
    for(const p of products)for(const o of p.purchaseOptions)if(!oid||o.purchaseOptionId===oid){
      const prior=old(p.productId)?.purchaseOptions.find(x=>x.purchaseOptionId===o.purchaseOptionId);
      if(!prior)throw Error(p.productId+' 请先创建后再启用');
      if(target==='INACTIVE'&&!['ACTIVE','INACTIVE'].includes(prior.state))throw Error(p.productId+' 此选项尚未启用');
      next[p.productId]||={};if(prior.state===target)delete next[p.productId][o.purchaseOptionId];else next[p.productId][o.purchaseOptionId]=target;
    }
    states=next;persist();render();close();status('状态变化已加入待提交');
  }}]);
}
function download(name,text,type){const url=URL.createObjectURL(new Blob([text],{type})),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
function languageDialog(){
  const scope=clone(selected.size?picked():draft);
  if(!scope.length)throw Error('请先读取或创建商品，再下载多语言模板');
  modal('多语言模板导入 · '+scope.length+' 个商品','<p class="help">当前范围：'+(selected.size?'所选商品':'当前项目的全部商品')+'。每行填写一个商品的一种语言；仅更新名称和描述，未列出的语言、地区和价格均保留。</p><ol class="help"><li>下载模板，已有名称和描述会自动填入。</li><li>用 Excel 等工具编辑，另存为 CSV UTF-8。四列表头保持不变。</li><li>选择文件，检查导入预览后应用到本地草稿。</li></ol><div class="form-grid">'+multiMarkup('templateLanguages','模板中追加的语言（可选，多选）')+'<div class="wide"><button id="downloadLanguages">下载多语言 CSV 模板</button></div><label class="field wide">上传已填写的模板<input id="languageFile" type="file" accept=".csv,text/csv"></label></div><p class="help">列：productId / languageCode / title / description。名称最多 55 字符，描述最多 200 字符；新增语言的空白内容需要填写后再导入。同一商品同一语言重复且内容不同会报错。</p>',[
    {label:'取消',run:close},{label:'检查并预览导入',class:'primary',run:async()=>{
      const file=$('languageFile').files[0];if(!file)throw Error('请选择多语言 CSV 模板');
      if(file.size>6*1024*1024)throw Error('文件超过 6MB，请分批导入');
      const result=await api('listings/import',{mode,csv:await file.text(),existing:scope});
      const rows=[];
      for(const p of result.products)for(const l of p.listings){
        const before=scope.find(x=>x.productId===p.productId)?.listings.find(x=>x.languageCode.toLowerCase()===l.languageCode.toLowerCase());
        if(!same(before,l))rows.push({id:p.productId,language:l.languageCode,before,after:l});
      }
      if(!rows.length)throw Error('模板内容与当前草稿一致，没有需要导入的变化');
      modal('多语言导入预览 · '+rows.length+' 条变化','<p class="help">确认后只更新本地草稿。之后仍需“预览并提交”才会修改 Google 商品。</p><table class="diff-table"><thead><tr><th>商品 / 语言</th><th>修改前</th><th>修改后</th></tr></thead><tbody>'+rows.map(r=>'<tr><td>'+esc(r.id+' / '+r.language)+'</td><td>'+esc(r.before?r.before.title+'\n'+r.before.description:'新增语言')+'</td><td>'+esc(r.after.title+'\n'+r.after.description)+'</td></tr>').join('')+'</tbody></table>',[{label:'取消',run:close},{label:'应用到草稿',class:'primary',run:()=>{replace(result.products);close();status('已更新 '+result.products.length+' 个商品的 '+rows.length+' 条多语言内容');}}]);
    }}
  ]);
  initMulti('templateLanguages',LANGUAGE_CODES.concat(scope.flatMap(p=>p.listings.map(l=>l.languageCode))),[],'language');
  bind('downloadLanguages',async()=>{
    const languages=$('templateLanguages').selectedValues();
    const data=await api('listings/template',{products:scope,languages});
    download('gp-multilingual-template.csv',data.csv,'text/csv;charset=utf-8');
  });
}
function importDialog(){
  modal('导入 CSV / JSON','<p class="help">CSV 按“商品 ID + 购买选项 + 语言 + 地区”合并，只修改文件中列出的名称、描述和地区价格；其他配置保留。建议先导出现有商品作为模板。JSON 适用于完整商品配置。</p><input id="importFile" type="file" accept=".csv,.json"><p class="help">支持 UTF-8 CSV（包含 BOM）。新商品默认创建购买类型的选项。</p><button id="template">下载单地区 CSV 模板</button> <button id="allRegionTemplate">下载全部地区 CSV 模板</button><div class="warning">全部地区：regionCode 填 ALL，price 填税前基准价，currencyCode 填基准币种，availability 填 AVAILABLE。每个商品可填不同基准价。工具将通过 Google 换算全部地区价格，需要真实授权。同一购买选项不要混用 ALL 与单地区行；需要特殊地区价时，可在导入后另行调整。</div><p id="importProgress" class="help" role="status"></p>',[{label:'取消',run:close},{label:'检查并导入草稿',class:'primary',run:async()=>{
    const f=$('importFile').files[0];if(!f)throw Error('请选择文件');if(f.size>6*1024*1024)throw Error('文件超过 6MB，请分批');
    const text=await f.text();let products;
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
  bind('template',()=>download('products-template.csv','\uFEFFproductId,purchaseOptionId,languageCode,title,description,regionCode,currencyCode,price,availability\r\ncoins_100,buy,en-US,100 Coins,Get 100 coins,US,USD,0.99,AVAILABLE\r\n','text/csv;charset=utf-8'));
  bind('allRegionTemplate',()=>download('products-all-regions-template.csv','\uFEFFproductId,purchaseOptionId,languageCode,title,description,regionCode,currencyCode,price,availability\r\ncoins_100,buy,en-US,100 Coins,Get 100 coins,ALL,USD,0.99,AVAILABLE\r\n','text/csv;charset=utf-8'));
}
async function exportDialog(){
  const products=selected.size?picked():draft;if(!products.length)throw Error('没有可导出的商品');
  modal('导出 '+products.length+' 个商品','<p>CSV 适合名称、描述、地区价格的批量编辑。完整 JSON 保留高级配置。</p>',[{label:'导出完整 JSON',run:()=>{download('gp-products.json',JSON.stringify(products,null,2),'application/json');close();}},{label:'导出 CSV',class:'primary',run:async()=>{const data=await api('export',{products});download('gp-products.csv',data.csv,'text/csv;charset=utf-8');close();}}]);
}
const fieldNames={listings:'语言',title:'名称',description:'描述',languageCode:'语言代码',purchaseOptions:'购买选项',regionalPricingAndAvailabilityConfigs:'地区',price:'价格',currencyCode:'币种',units:'整数金额',nanos:'小数纳单位',availability:'销售状态',buyOption:'购买设置',state:'启用状态',productId:'商品 ID',packageName:'包名',taxAndComplianceSettings:'税务设置',legacyCompatible:'兼容旧版',multiQuantityEnabled:'多件购买',offerTags:'标签'};
function formatValue(v){if(v===null)return '—';if(typeof v==='object')return JSON.stringify(v);return String(v);}
async function preview(){
  const products=(selected.size?picked():draft).filter(dirty);
  if(!products.length)throw Error('所选范围内没有待提交变化');
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
    '<div class="warning">'+(mode==='demo'?'演示操作，仅写入本机示例数据。':'即将修改真实 Google Play 商品。')+'<br>目标：'+esc(mode==='demo'?'演示工作区':settings.current.name)+' · <b>'+esc(plan.packageName)+'</b><br>预览有效期 15 分钟。新商品保存为草稿；已有启用商品的改价会影响后续购买。</div>'+plan.entries.map(e=>'<section class="preview-item"><h3>'+esc(e.after.productId)+' <span class="pill '+(e.before?'':'orange')+'">'+(e.before?'更新':'创建')+'</span></h3><table class="diff-table"><thead><tr><th>字段</th><th>修改前</th><th>修改后</th></tr></thead><tbody>'+e.changes.map(c=>'<tr><td>'+esc(c.path.split('.').map(x=>fieldNames[x]||x).join(' / '))+'</td><td>'+esc(formatValue(c.before))+'</td><td>'+esc(formatValue(c.after))+'</td></tr>').join('')+'</tbody></table></section>').join('')+'<label class="checkline"><input type="checkbox" id="confirmWrite">我已核对目标项目和上述变更</label>',[
    {label:'返回编辑',run:close},{label:mode==='demo'?'提交演示变更':'提交到 Google Play',class:'primary',run:async()=>{
      if(!$('confirmWrite').checked)throw Error('请先核对并勾选变更确认');
      const result=await job(()=>api('commit',{id:plan.id,mode:plan.mode,packageName:plan.packageName}),'正在提交并逐项读回核对，请勿关闭工具…');
      activePlan=null;
      for(const r of result.results)if(r.status==='verified'){
        base=base.filter(p=>p.productId!==r.productId);base.push(r.actual);
        draft=draft.filter(p=>p.productId!==r.productId);draft.push(clone(r.actual));delete states[r.productId];selected.delete(r.productId);
      }
      persist();render();
      modal('提交结果',result.results.map(r=>'<div class="result-row"><b>'+esc(r.productId)+' <span class="pill '+(r.status==='verified'?'green':'orange')+'">'+esc({verified:'已核对',pending:'等待核对',uncertain:'状态不确定',failed:'未写入'}[r.status])+'</span></b><p>'+esc(r.message)+'</p></div>').join('')+'<p class="help">本机记录：data/'+esc(result.logFile)+'。失败或待核对商品的草稿已保留。结果不确定时，请先在后台核对，避免直接重复提交。</p>',[{label:'关闭',class:'primary',run:close}]);
      status('处理完成：'+result.results.filter(r=>r.status==='verified').length+'/'+result.results.length+' 个商品已读回核对');
    }}]);
}
function discard(){
  const products=picked();modal('撤销所选草稿','<p>撤销 '+products.length+' 个商品的本地修改，未提交的新商品将从草稿中移除。</p>',[{label:'取消',run:close},{label:'撤销草稿',run:()=>{
    for(const p of products){draft=draft.filter(x=>x.productId!==p.productId);if(old(p.productId))draft.push(clone(old(p.productId)));delete states[p.productId];}selected.clear();persist();render();close();
  }}]);
}
async function history(){
  const data=await api('history');modal('最近操作记录',data.operations.length?data.operations.map(o=>'<section class="preview-item"><h3>'+esc(new Date(o.startedAt).toLocaleString())+' · '+esc(o.mode==='demo'?'演示':'真实')+' · '+esc(o.packageName)+'</h3>'+o.results.map(r=>'<div class="result-row"><b>'+esc(r.productId)+' · '+esc(r.status)+'</b><p>'+esc(r.message)+'</p></div>').join('')+'<p class="help">'+esc(o.file)+'</p></section>').join(''):'<p class="help">还没有提交记录。</p>',[{label:'关闭',run:close}]);
}
async function init(){
  token=(await(await fetch('/api/session')).json()).token;settings=await api('config');await restoreVisit();restore();
  bind('newProject',()=>openSettings(''));bind('settings',()=>openSettings());bind('refresh',refresh);bind('create',newProduct);bind('copy',copyProducts);bind('price',priceDialog);bind('import',importDialog);bind('languages',languageDialog);bind('export',exportDialog);bind('preview',preview);bind('activate',()=>changeState('ACTIVE'));bind('deactivate',()=>changeState('INACTIVE'));bind('discard',discard);bind('history',history);bind('closeModal',close);
  $('modal').addEventListener('cancel',e=>{if(working)e.preventDefault();});
  $('search').oninput=e=>{search=e.target.value;render();};
  $('selectAll').onchange=e=>{draft.filter(p=>(p.productId+' '+p.listings.map(l=>l.title).join(' ')).toLowerCase().includes(search)).forEach(p=>e.target.checked?selected.add(p.productId):selected.delete(p.productId));render();};
  $('mode').onchange=async()=>{if(working)return;persist();mode=$('mode').value;restore();status('已切换工作区');if(mode==='demo'&&!draft.length){try{await loadProducts();}catch(e){showError(e.message);}}};
  $('project').onchange=async()=>{if(working)return;try{persist();settings=await api('config/switch',{id:$('project').value});restore();status('已切换到 '+settings.current.name+'；点击读取商品加载此项目');}catch(e){showError(e.message);render();}};
  if(!draft.length)await loadProducts();else status('已恢复本机草稿');
}
init().catch(e=>showError(e.message));
