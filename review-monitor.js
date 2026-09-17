'use strict';
const fs=require('node:fs'),crypto=require('node:crypto');
const labels={DRAFT:'草稿',NOT_SENT_FOR_REVIEW:'待送审',IN_REVIEW:'审核中',APPROVED_NOT_PUBLISHED:'通过待发布',NOT_APPROVED:'审核未通过',PUBLISHED:'已发布',UNSPECIFIED:'未知状态'};
const stateLabel=value=>labels[String(value).replace(/^RELEASE_LIFECYCLE_STATE_/,'')]||'未知状态（'+value+'）';
function createMonitor({file,profiles,listReleases,now=()=>Date.now()}){
  let data={};try{data=JSON.parse(fs.readFileSync(file,'utf8'));}catch(e){if(e.code!=='ENOENT')throw Error('审核监控配置无法读取');}
  const write=()=>{fs.writeFileSync(file+'.tmp',JSON.stringify(data,null,2));fs.renameSync(file+'.tmp',file);};
  function get(id){const p=profiles().find(p=>p.id===id);if(!p)throw Error('项目不存在');const s=data[id];return s?.packageName===p.packageName?s:{packageName:p.packageName,enabled:false,tracks:['production'],intervalMinutes:5,snapshot:[],events:[],lastCheck:null,nextCheck:0,error:'',unread:0};}
  function configure(id,input){
    const p=profiles().find(p=>p.id===id);if(!p)throw Error('项目不存在');
    if(typeof input.enabled!=='boolean'||![5,15,30,60].includes(input.intervalMinutes))throw Error('请选择有效的监控开关和检查间隔');
    if(!Array.isArray(input.tracks)||!input.tracks.length||input.tracks.length>8||input.tracks.some(t=>typeof t!=='string'||!t.trim()||t.length>100||/[\x00-\x1f/\\]/.test(t)))throw Error('请选择 1–8 个有效发布轨道');
    const old=get(id),tracks=[...new Set(input.tracks.map(t=>t.trim()))];
    const scopeChanged=JSON.stringify(tracks)!==JSON.stringify(old.tracks);
    data[id]={...old,enabled:input.enabled,tracks,intervalMinutes:input.intervalMinutes,nextCheck:0,error:'',...(scopeChanged?{snapshot:[],lastCheck:null,events:[],unread:0}:{})};
    write();return get(id);
  }
  function status(id){return structuredClone(get(id));}
  function acknowledge(id){data[id]={...get(id),unread:0};write();return status(id);}
  const checking=new Map();
  function check(id){if(checking.has(id))return checking.get(id);const pending=checkOnce(id).finally(()=>checking.delete(id));checking.set(id,pending);return pending;}
  async function checkOnce(id){
    const profile=profiles().find(p=>p.id===id);if(!profile)throw Error('项目不存在');
    const original=get(id),stamp=new Date(now()).toISOString(),snapshot=[];
    try{
      for(const track of original.tracks){
        const result=await listReleases(profile,track);
        if(result.releases!==undefined&&!Array.isArray(result.releases))throw Error('Google 返回的版本列表无效');
        for(const release of result.releases||[]){
          const versions=(release.activeArtifacts||[]).map(a=>String(a.versionCode)).sort();
          snapshot.push({key:JSON.stringify([track,release.releaseName||'',versions]),track,name:release.releaseName||'未命名版本',versionCodes:versions,state:release.releaseLifecycleState||'RELEASE_LIFECYCLE_STATE_UNSPECIFIED'});
        }
      }
      const current=get(id);if(JSON.stringify(current.tracks)!==JSON.stringify(original.tracks)||current.packageName!==profile.packageName)return status(id);
      const prior=new Map(original.snapshot.map(r=>[r.key,r]));
      const events=original.lastCheck?snapshot.filter(r=>prior.get(r.key)?.state!==r.state).map(r=>({id:crypto.randomUUID(),at:stamp,track:r.track,name:r.name,versionCodes:r.versionCodes,before:prior.get(r.key)?.state||null,after:r.state})):[];
      data[id]={...current,snapshot,events:events.concat(current.events).slice(0,100),unread:Math.min(100,current.unread+events.length),lastCheck:stamp,lastAttempt:stamp,nextCheck:now()+current.intervalMinutes*60000,error:''};
    }catch(e){
      const current=get(id);data[id]={...current,lastAttempt:stamp,nextCheck:now()+current.intervalMinutes*60000,error:e.message+(e.status===403?'；请在 Play Console 为该服务账号补充目标应用的版本查看权限，并确认包名正确。':'')};
    }
    write();return status(id);
  }
  function due(){return profiles().find(p=>{const s=get(p.id);return s.enabled&&s.nextCheck<=now();})?.id;}
  function summary(){return profiles().map(p=>({id:p.id,name:p.name,packageName:p.packageName,...status(p.id)}));}
  return {configure,status,acknowledge,check,due,summary};
}
module.exports={createMonitor,stateLabel};
