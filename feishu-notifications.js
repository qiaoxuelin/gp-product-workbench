'use strict';
const fs=require('node:fs'),crypto=require('node:crypto');
const STATES=['RELEASE_LIFECYCLE_STATE_APPROVED_NOT_PUBLISHED','RELEASE_LIFECYCLE_STATE_PUBLISHED','RELEASE_LIFECYCLE_STATE_IN_REVIEW'];
const labels={RELEASE_LIFECYCLE_STATE_IN_REVIEW:'已提审，审核中',RELEASE_LIFECYCLE_STATE_APPROVED_NOT_PUBLISHED:'审核通过，待手动发布',RELEASE_LIFECYCLE_STATE_PUBLISHED:'已发布（可能为分阶段发布）'};
function webhook(value){
  let u;try{u=new URL(String(value).trim());}catch{throw Error('请输入有效的飞书机器人 Webhook');}
  if(u.origin!=='https://open.feishu.cn'||u.username||u.password||u.search||u.hash||!/^\/open-apis\/bot\/v2\/hook\/[a-zA-Z0-9-]{16,100}$/.test(u.pathname))throw Error('仅支持 https://open.feishu.cn/open-apis/bot/v2/hook/ 开头的机器人地址');
  return u.href;
}
function sign(timestamp,secret){return crypto.createHmac('sha256',timestamp+'\n'+secret).update('').digest('base64');}
const clean=value=>String(value??'').replace(/[\r\n]/g,' ').replace(/</g,'＜').replace(/>/g,'＞').slice(0,300);
const withMention=(text,mentionAll)=>mentionAll?'<at user_id="all">所有人</at>\n'+text:text;
function message(profile,event){return ['PlayBatch · Google Play 审核通知','项目：'+clean(profile.name||profile.packageName),'包名：'+clean(profile.packageName),'轨道：'+clean(event.track),'版本：'+clean(event.name)+' ['+clean(event.versionCodes?.join(', '))+']','状态：'+labels[event.after],'检测时间：'+event.at,'https://play.google.com/console'].join('\n');}
function createNotifier({file,protect,fetchImpl=fetch,now=()=>Date.now(),sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms))}){
  let data={};try{data=JSON.parse(fs.readFileSync(file,'utf8'));}catch(e){if(e.code!=='ENOENT')throw Error('飞书通知配置无法读取');}
  const write=()=>{fs.writeFileSync(file+'.tmp',JSON.stringify(data,null,2),{mode:0o600});fs.renameSync(file+'.tmp',file);};
  for(const s of Object.values(data))for(const log of s.deliveries||[])if(log.status==='sending'){log.status='uncertain';log.error='上次发送中断，请先查看群消息，再决定是否重试';}
  function current(profile){const s=data[profile.id];return s?.packageName===profile.packageName?s:{packageName:profile.packageName,enabled:false,states:STATES.slice(0,2),enabledSince:0,hasSecret:false,sealed:'',deliveries:[]};}
  const targetInfo=s=>s.targets||(s.sealed?[{id:'primary',name:'群机器人 1',hasWebhook:true,hasSecret:s.hasSecret}]:[]);
  function status(profile){const s=current(profile);return {enabled:s.enabled,mentionAll:s.mentionAll===true,states:s.states,hasWebhook:!!s.sealed,hasSecret:s.hasSecret,targets:targetInfo(s),deliveries:s.deliveries.slice(0,30).map(({id,status,error,at,sentAt,kind,text,targetId,targetName})=>({id,status,error,at,sentAt,kind,text,targetId,targetName}))};}
  function decrypt(s){try{return JSON.parse(protect(s.sealed,true));}catch{throw Error('无法解密机器人配置，请用原 Windows 用户运行，或重新填写 Webhook 和签名密钥');}}
  function configure(profile,input){
    if(typeof input.enabled!=='boolean'||!Array.isArray(input.states)||!input.states.length||input.states.some(s=>!STATES.includes(s)))throw Error('请选择有效的通知开关和触发状态');
    if(input.mentionAll!==undefined&&typeof input.mentionAll!=='boolean')throw Error('请选择有效的 @全体成员开关');
    if(active.has(profile.id)&&input.enabled!==false)throw Error('正在发送通知，请稍后再修改设置');
    const old=current(profile);
    let previous=[];
    if(old.sealed){const value=decrypt(old);previous=value.targets||[{id:'primary',name:'群机器人 1',...value}];}
    const inputs=input.targets===undefined?[{id:'primary',webhook:input.webhook,secret:input.secret,clearSecret:input.clearSecret},...previous.filter(t=>t.id!=='primary').map(t=>({id:t.id}))]:input.targets;
    if(!Array.isArray(inputs)||inputs.length>10)throw Error('最多配置 10 个群机器人');
    const targets=inputs.map((entry,index)=>{
      if(!entry||typeof entry!=='object')throw Error('机器人配置无效');
      const prior=previous.find(t=>t.id===entry.id);
      if(entry.id&&!prior&&entry.id!=='primary')throw Error('机器人已不存在，请重新打开配置');
      const id=prior?.id||((index===0&&!previous.length)?'primary':crypto.randomUUID());
      const target={id,name:String(entry.name||prior?.name||('群机器人 '+(index+1))).trim().slice(0,80),webhook:prior?.webhook||'',secret:prior?.secret||''};
      if(entry.webhook?.trim())target.webhook=webhook(entry.webhook);
      if(entry.clearSecret)target.secret='';
      else if(entry.secret?.trim()){if(entry.secret.length>256)throw Error('签名密钥过长');target.secret=entry.secret.trim();}
      if(!target.webhook&&inputs.length===1&&!input.enabled)return null;
      if(!target.webhook)throw Error('请填写每个机器人的 Webhook');
      return target;
    }).filter(Boolean);
    if(input.enabled&&!targets.length)throw Error('请先填写飞书机器人 Webhook');
    if(new Set(targets.map(t=>t.webhook)).size!==targets.length||new Set(targets.map(t=>t.id)).size!==targets.length)throw Error('机器人 Webhook 或 ID 重复');
    const stamp=now(),stateSince=Object.fromEntries(input.states.map(state=>[state,input.enabled&&(!old.enabled||!old.states.includes(state))?stamp:(old.stateSince?.[state]??old.enabledSince)]));
    const targetSince=Object.fromEntries(targets.map(t=>[t.id,old.targetSince?.[t.id]??(previous.some(p=>p.id===t.id)?old.enabledSince:stamp)]));
    data[profile.id]={...old,enabled:input.enabled,mentionAll:input.mentionAll??(old.mentionAll===true),states:[...new Set(input.states)],stateSince,targetSince,enabledSince:input.enabled&&!old.enabled?stamp:old.enabledSince,
      sealed:targets.length?protect(JSON.stringify({targets})):'',hasSecret:targets.some(t=>!!t.secret),targets:targets.map(({id,name,secret})=>({id,name,hasWebhook:true,hasSecret:!!secret}))};
    write();return status(profile);
  }
  async function send(secrets,text){
    const timestamp=String(Math.floor(now()/1000)),body={msg_type:'text',content:{text}};
    if(secrets.secret){body.timestamp=timestamp;body.sign=sign(timestamp,secrets.secret);}
    let response,result;
    try{response=await fetchImpl(webhook(secrets.webhook),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),redirect:'error',signal:AbortSignal.timeout(15000)});result=await response.json();}
    catch{throw Object.assign(Error('发送结果不明：网络超时或响应异常。请先查看飞书群消息，再决定是否重试。'),{uncertain:true});}
    if(!response.ok)throw Object.assign(Error('飞书返回 HTTP '+response.status+'，请检查网络或机器人设置'),{uncertain:response.status>=500});
    const code=result.code??result.StatusCode;
    if(code!==0)throw Object.assign(Error('飞书未确认成功（错误码 '+String(code??'未知').slice(0,20)+'），请检查机器人关键词、签名和访问限制'),{uncertain:code===undefined});
  }
  const active=new Map();
  function exclusive(id,fn){if(active.has(id))return active.get(id);const p=fn().finally(()=>active.delete(id));active.set(id,p);return p;}
  async function deliver(profile,id){
    const s=current(profile),entry=s.deliveries.find(d=>d.id===id);if(!entry||entry.status==='sent')return;
    let secrets;try{const value=decrypt(s);secrets=(value.targets||[{id:'primary',...value}]).find(t=>t.id===(entry.targetId||'primary'));if(!secrets)throw Error('该通知的机器人已移除，无法重试');}catch(e){entry.status='failed';entry.error=e.message;write();return;}
    entry.status='sending';entry.error='';entry.at=new Date(now()).toISOString();write();
    try{await send(secrets,entry.text);entry.status='sent';entry.sentAt=new Date(now()).toISOString();}
    catch(e){entry.status=e.uncertain?'uncertain':'failed';entry.error=e.message;}
    write();
  }
  function process(profile,events){
    return exclusive(profile.id,async()=>{
      const s=current(profile);if(!s.enabled||!s.sealed)return status(profile);
      const seen=new Set(s.deliveries.map(d=>d.id)),retained=s.seenEventTargets||{},marks=Object.create(null);
      for(const event of [...events].reverse()){
        const eventTime=Date.parse(event.at);
        if(!Number.isFinite(eventTime)||!s.states.includes(event.after)||eventTime<Math.max(s.enabledSince,s.stateSince?.[event.after]||0))continue;
        marks[event.id]=[...(retained[event.id]||[])];
        for(const target of targetInfo(s)){
          const id=target.id==='primary'?event.id:event.id+':'+target.id;
          if(marks[event.id].includes(target.id))continue;
          if(seen.has(id)){marks[event.id].push(target.id);continue;}
          if(eventTime<(s.targetSince?.[target.id]||0))continue;
          marks[event.id].push(target.id);
          s.deliveries.unshift({id,targetId:target.id,targetName:target.name,kind:'event',status:'pending',text:withMention(message(profile,event),s.mentionAll===true),at:new Date(now()).toISOString()});seen.add(id);
        }
      }
      s.seenEventTargets=marks;data[profile.id]=s;write();
      // Send sequentially at <= 1 request/sec to avoid bursts. Pausing configuration cancels pending sends.
      for(const entry of [...s.deliveries].reverse())if(entry.status==='pending'){
        if(!current(profile).enabled)break;
        await deliver(profile,entry.id);await sleep(1050);
      }
      current(profile).deliveries=current(profile).deliveries.slice(0,500);write();return status(profile);
    });
  }
  function test(profile){if(active.has(profile.id))throw Error('正在发送通知，请稍后再试');return exclusive(profile.id,async()=>{
    const s=current(profile);if(!s.sealed)throw Error('请先保存 Webhook');
    const targets=targetInfo(s);
    for(let i=0;i<targets.length;i++){
      const target=targets[i],id='test-'+crypto.randomUUID();
      s.deliveries.unshift({id,targetId:target.id,targetName:target.name,kind:'test',status:'pending',text:withMention('PlayBatch · 飞书机器人测试通知\n项目：'+clean(profile.name||profile.packageName)+'\n这是一条测试消息，不代表应用已过审或发布。',s.mentionAll===true),at:new Date(now()).toISOString()});
      data[profile.id]=s;write();await deliver(profile,id);if(i<targets.length-1)await sleep(1050);
    }
    return status(profile);
  });}
  function retry(profile,id){
    if(active.has(profile.id))throw Error('正在发送通知，请稍后再试');
    return exclusive(profile.id,async()=>{const entry=current(profile).deliveries.find(d=>d.id===id);if(!entry||!['failed','uncertain'].includes(entry.status))throw Error('该通知不可重试');await deliver(profile,id);return status(profile);});
  }
  return {configure,status,process,test,retry};
}
module.exports={createNotifier,webhook,sign,STATES,message};
