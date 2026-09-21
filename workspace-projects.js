'use strict';
const crypto=require('node:crypto');
function createWorkspaceProjects({read,save,googleProfiles,appleProfiles}){
 function snapshot(){
  const profiles={google:googleProfiles(),apple:appleProfiles()},stored=read('workspace-projects.json',{projects:[]});
  const projects=stored.projects.map(p=>({...p}));
  for(const platform of ['google','apple']){
   const field=platform+'Id',claimed=new Set();
   for(const p of projects){if(p[field]&&!profiles[platform].some(x=>x.id===p[field]))p[field]='';if(p[field]){if(claimed.has(p[field]))throw Error('平台配置被重复关联，请检查项目配置');claimed.add(p[field]);}}
   for(const p of profiles[platform])if(!claimed.has(p.id)){let id=platform+':'+p.id;while(projects.some(x=>x.id===id))id+=':unlinked';projects.push({id,name:p.name,googleId:'',appleId:'',[field]:p.id});}
  }
  return {projects,profiles,revision:crypto.createHash('sha256').update(JSON.stringify(projects)).digest('hex')};
 }
 function update(input){
  const state=snapshot();if(input.revision!==state.revision)throw Error('项目配置已变化，请重新打开项目设置');
  if(typeof input.name!=='string'||!input.name.trim()||input.name.length>100)throw Error('请填写项目名称，最多 100 字符');
  const old=input.id?state.projects.find(p=>p.id===input.id):null;if(input.id&&!old)throw Error('项目不存在');
  const next={id:old?.id||crypto.randomUUID(),name:input.name.trim(),googleId:input.googleId||'',appleId:input.appleId||''};
  const projects=state.projects.map(p=>({...p}));
  for(const platform of ['google','apple']){
   const field=platform+'Id',other=platform==='google'?'appleId':'googleId';
   if(next[field]&&!state.profiles[platform].some(p=>p.id===next[field]))throw Error('所选平台配置不存在');
   const owner=projects.find(p=>p.id!==next.id&&p[field]&&p[field]===next[field]);
   if(owner){if(owner[other])throw Error('该平台已关联其他双平台项目，请先在原项目解除关联');owner[field]='';}
  }
  // Keep a detached platform configuration available as its own project on the next read.
  const rows=projects.filter(p=>p.id!==next.id&&(p.googleId||p.appleId||!(p.id.startsWith('google:')||p.id.startsWith('apple:'))));
  // A migrated single-platform project becomes empty when explicitly merged into another.
  const moved=state.projects.filter(p=>p.id!==next.id&&((p.googleId&&p.googleId===next.googleId)||(p.appleId&&p.appleId===next.appleId))).map(p=>p.id);
  save('workspace-projects.json',{projects:rows.filter(p=>!moved.includes(p.id)||p.googleId||p.appleId).concat(next)});
  return {...snapshot(),activeId:next.id};
 }
 return {snapshot,update};
}
module.exports={createWorkspaceProjects};
