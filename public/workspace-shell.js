'use strict';
window.WorkspaceShell=(()=>{
 const navigationHistory=window.history;
 const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const names={google:'Google Play',apple:'App Store'},urls={google:'/',apple:'/apple.html'},storageKey='playbatch-project-v1';
 async function mount(adapter){
  let state,activeId='',pending=false;
  const features={products:'商品管理',monitor:'审核与发布监控',billing:'账单导出'};
  let feature=new URL(location.href).searchParams.get('feature')||'products';if(!Object.hasOwn(features,feature))feature='products';
  const host=document.getElementById('workspaceShell');
  const platformTools=document.querySelector('.platform-tools');
  const call=async(path,body={})=>{const session=await(await fetch('/api/session')).json();const response=await fetch('/api/'+path,{method:'POST',headers:{'Content-Type':'application/json','X-GP-Token':session.token},body:JSON.stringify(body)});const result=await response.json();if(!response.ok)throw Error(result.error||'项目设置读取失败');return result;};
  const current=()=>state?.projects.find(p=>p.id===activeId);
  const canLeave=()=>{if(adapter.busy()||pending)return false;if(adapter.canLeaveFeature&&!adapter.canLeaveFeature())return false;if(adapter.persist()===false)throw Error('草稿未能保存，请先导出备份');return true;};
  function remember(){try{if(activeId)localStorage.setItem(storageKey,activeId);}catch{}const url=new URL(location.href);if(activeId)url.searchParams.set('project',activeId);else url.searchParams.delete('project');url.searchParams.delete('live');url.searchParams.set('feature',feature);navigationHistory.replaceState(null,'',url.pathname+url.search);}
  async function draw(){
   const project=current(),field=adapter.platform+'Id',configured=!!project?.[field];
   document.title=(project?project.name+' · ':'')+names[adapter.platform]+' · '+features[feature]+' · PlayBatch';
   platformTools.remove();
   host.innerHTML='<div class="workspace-heading"><div><span class="eyebrow">项目工作台</span><h1>'+(project?esc(project.name):'选择或创建项目')+'</h1></div><div class="workspace-controls"><label class="field">当前项目<select id="workspaceProject" aria-label="当前项目">'+(state.projects.length?(!activeId?'<option value="">请选择项目</option>':'')+state.projects.map(p=>'<option value="'+esc(p.id)+'" '+(p.id===activeId?'selected':'')+'>'+esc(p.name)+'</option>').join(''):'<option value="">暂无项目</option>')+'</select></label><button id="workspaceManage" '+(!project?'disabled':'')+'>项目设置</button><button id="workspaceCreate">＋ 新建项目</button></div></div><nav class="platform-tabs" aria-label="项目平台">'+['google','apple'].map(platform=>'<a href="'+urls[platform]+(project?'?project='+encodeURIComponent(project.id)+(platform==='google'?'&live=1':''):'')+'" data-platform="'+platform+'" '+(platform===adapter.platform?'aria-current="page"':'')+'>'+names[platform]+'<small>'+(project?.[platform+'Id']?'已关联应用':'未关联应用')+'</small></a>').join('')+'</nav>';
   const navigation=document.createElement('div');navigation.className='platform-navigation';navigation.append(host.querySelector('.platform-tabs'),platformTools);host.append(navigation);
   const projectSettings=host.querySelector('#workspaceManage');projectSettings.classList.add('project-settings-action');projectSettings.title='修改项目名称及 Google Play / App Store 应用关联';host.querySelector('.workspace-heading').append(projectSettings);
   document.getElementById('projectNavigation').replaceChildren(host.querySelector('.workspace-controls'));
   document.getElementById('workspaceProject').onchange=e=>guard(()=>select(e.target.value));
   document.getElementById('workspaceCreate').onclick=()=>guard(()=>manage(true));
   document.getElementById('workspaceManage').onclick=()=>guard(()=>manage(false));
   host.querySelectorAll('[data-platform]').forEach(link=>link.onclick=e=>{if(link.dataset.platform===adapter.platform){e.preventDefault();return;}try{if(!canLeave())e.preventDefault();}catch(error){e.preventDefault();adapter.error(error);}});
   const demo=adapter.platform==='google'&&adapter.isDemo()&&feature==='products';
   for(const id of ['history']){const button=document.getElementById(id);if(button)button.disabled=!configured&&!demo;}
   host.querySelector('.eyebrow').textContent=demo?'演示工作区 · 示例数据独立于项目':'当前项目';
   if(demo)host.querySelector('h1').textContent='Google Play 功能演示';
   document.getElementById('platformContent').hidden=!configured&&!demo;
   const empty=document.getElementById('platformMissing');empty.hidden=configured||demo;
   empty.innerHTML='<div class="empty-symbol">＋</div><h2>'+(project?'为 '+esc(project.name)+' 关联 '+names[adapter.platform]:'先创建一个项目')+'</h2><p>'+(project?'配置该平台的应用与授权，或在项目设置中关联已有应用。':'一个项目可以同时管理 Google Play 和 App Store 的商品。')+'</p><div class="missing-actions"><button class="primary" id="workspaceConnect">'+(project?'配置 '+names[adapter.platform]:'新建项目')+'</button>'+(project?'<button id="workspaceLink">关联已有应用</button>':'')+'</div>';
   empty.querySelector('#workspaceConnect').onclick=()=>guard(()=>project?adapter.configure('',project.name):manage(true));
   if(project)empty.querySelector('#workspaceLink').onclick=()=>guard(()=>manage(false));
   host.querySelectorAll('[data-platform]').forEach(link=>{const url=new URL(link.href);url.searchParams.set('feature',feature);link.href=url.pathname+url.search;});
   document.querySelectorAll('[data-feature]').forEach(button=>{button.setAttribute('aria-pressed',String(button.dataset.feature===feature));button.onclick=()=>guard(async()=>{if(feature===button.dataset.feature||!canLeave())return;feature=button.dataset.feature;remember();await draw();});});
   const panel=document.getElementById('featurePanel');panel.replaceChildren();panel.hidden=feature==='products';
   document.getElementById('platformContent').hidden=feature!=='products'||(!configured&&!demo);
   if(feature!=='products'){
    empty.hidden=true;
    if(adapter.platform==='apple')panel.innerHTML='<h2>'+features[feature]+'</h2><div class="feature-empty"><span class="pill">暂未支持</span><h3>App Store '+features[feature]+'尚未接入</h3><p>当前项目和平台已保留，此页面暂不能查询或执行操作。</p></div>';
    else if(!configured){panel.innerHTML='<h2>'+features[feature]+'</h2>';empty.hidden=false;}
    else {panel.innerHTML='<h2>'+features[feature]+'</h2><p role="status">正在加载…</p>';try{await adapter.openFeature(feature);}catch(error){panel.innerHTML='<h2>'+features[feature]+'</h2><p class="error-box">'+esc(error.message)+'</p><button id="retryFeature">重新加载</button>';panel.querySelector('button').onclick=()=>guard(draw);}}
   }
  }
  async function guard(fn){try{if(adapter.busy()||pending)return;await fn();}catch(error){adapter.error(error);await draw();}}
  async function select(id){
   if(!canLeave()){document.getElementById('workspaceProject').value=activeId;return;}const next=state.projects.find(p=>p.id===id);if(!next)throw Error('项目不存在');
   pending=true;host.inert=true;document.getElementById('projectNavigation').inert=true;try{await adapter.select(next[adapter.platform+'Id']||'');activeId=id;remember();await draw();}finally{pending=false;host.inert=false;document.getElementById('projectNavigation').inert=false;}
  }
  function manage(isNew){
   if(!canLeave())return;const project=isNew?null:current();
   const options=platform=>'<option value="">稍后配置</option>'+state.profiles[platform].map(p=>{const owner=state.projects.find(x=>x[platform+'Id']===p.id),other=platform==='google'?'appleId':'googleId',blocked=owner&&owner.id!==project?.id&&owner[other];return '<option value="'+esc(p.id)+'" '+(project?.[platform+'Id']===p.id?'selected':'')+' '+(blocked?'disabled':'')+'>'+esc(p.name+' · '+(p.packageName||p.bundleId))+(blocked?'（已关联其他项目）':'')+'</option>';}).join('');
   adapter.modal(isNew?'新建项目':'项目设置','<p class="help">在这里管理项目名称和平台应用关联。包名、App ID 和 API 凭据请到对应平台的“平台应用与授权”中管理。</p><div class="form-grid"><label class="field wide">项目名称<input id="workspaceName" maxlength="100" value="'+esc(project?.name||'')+'" placeholder="例如：星光旅店"></label><div class="wide"><h3 class="section-title">平台应用关联</h3><p class="help">选择归属于此项目的 Google Play 和 App Store 应用。</p></div><label class="field">Google Play 应用<select id="workspaceGoogle">'+options('google')+'</select></label><label class="field">App Store 应用<select id="workspaceApple">'+options('apple')+'</select></label></div><p class="help">选择已有应用并保存，会将它归入本项目。未关联的平台可以稍后配置；解除关联不会删除平台数据。</p>',[{label:'取消',run:adapter.close},{label:'保存项目',class:'primary',run:async()=>{
    if(!canLeave())return;const payload={id:project?.id||'',name:document.getElementById('workspaceName').value,googleId:document.getElementById('workspaceGoogle').value,appleId:document.getElementById('workspaceApple').value,revision:state.revision};
    pending=true;host.inert=true;try{state=await call('projects/save',payload);await adapter.select(state.projects.find(p=>p.id===state.activeId)[adapter.platform+'Id']||'');activeId=state.activeId;remember();adapter.close();await draw();adapter.status('项目已保存，可切换平台管理商品');}finally{pending=false;host.inert=false;}
   }}]);
  }
  const enterDemo=()=>{if(canLeave())location.assign('/?demo=1');};
  if(adapter.platform==='google'&&adapter.isDemo()){
   const exitDemo=()=>{if(canLeave())location.assign('/');};
   document.title='独立演示工作区 · PlayBatch';
   document.querySelector('aside>.nav-group-label').hidden=true;
   host.innerHTML='<div class="workspace-heading"><div><span class="eyebrow">独立体验 · 不关联真实项目</span><h1>Google Play 商品演示</h1></div><button id="demoExit">退出演示</button></div>';
   document.getElementById('projectNavigation').innerHTML='<p class="demo-rail-note">演示工作区<br>示例商品与真实项目隔离</p>';
   platformTools.hidden=true;document.getElementById('featureNavigation').hidden=true;document.getElementById('platformMissing').hidden=true;document.getElementById('featurePanel').hidden=true;document.getElementById('platformContent').hidden=false;
   document.getElementById('demoExit').onclick=exitDemo;
   return {current:()=>null,hasPlatform:()=>false,activeFeature:()=> 'products',enterDemo,exitDemo,configure:exitDemo};
  }
  state=await call('projects');let remembered='';try{remembered=localStorage.getItem(storageKey)||'';}catch{}
  const requested=new URL(location.href).searchParams.get('project');
  const choice=requested?(state.projects.some(p=>p.id===requested)?requested:''):[remembered,state.projects.find(p=>p[adapter.platform+'Id']===adapter.profileId())?.id,state.projects[0]?.id].find(id=>state.projects.some(p=>p.id===id));
  if(choice){activeId=choice;await adapter.select(current()[adapter.platform+'Id']||'',true);remember();}else if(requested){await adapter.select('');adapter.status('所选项目不存在，请重新选择项目',true);}await draw();
  return {
   enterDemo,current,activeFeature:()=>feature,hasPlatform:()=>!!current()?.[adapter.platform+'Id'],
   async refreshMode(){if(!adapter.isDemo())await adapter.select(current()?.[adapter.platform+'Id']||'');await draw();},
   async profileSaved(id){
    const prior=current();state=await call('projects');
    if(prior&&!prior[adapter.platform+'Id']){state=await call('projects/save',{...prior,[adapter.platform+'Id']:id,revision:state.revision});activeId=state.activeId;}
    else activeId=state.projects.find(p=>p[adapter.platform+'Id']===id)?.id||activeId;
    remember();await draw();
   },
   configure(){if(!canLeave())return;const project=current();if(!project)return manage(true);adapter.configure(project[adapter.platform+'Id']||'',project.name);},
   manage:()=>manage(false)
  };
 }
 return {mount};
})();
