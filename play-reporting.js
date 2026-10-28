'use strict';
const SCOPE='https://www.googleapis.com/auth/playdeveloperreporting';
const HOUR=3600000;
function query(input={},now=Date.now()){
  const end=input.endTime||new Date(Math.floor(now/HOUR)*HOUR).toISOString();
  if(typeof end!=='string'||!Number.isFinite(Date.parse(end)))throw Error('请选择有效的结束时间');
  const start=input.startTime||new Date(Date.parse(end)-24*HOUR).toISOString();
  for(const value of [start,end])if(typeof value!=='string'||!/^\d{4}-\d\d-\d\dT\d\d:00(?::00(?:\.000)?)?Z$/.test(value)||!Number.isFinite(Date.parse(value))||new Date(value).toISOString().slice(0,13)!==value.slice(0,13))throw Error('时间必须是有效的 UTC 整点');
  if(Date.parse(start)>=Date.parse(end)||Date.parse(end)>now)throw Error('起始时间必须早于结束时间，结束时间不能在未来');
  if(Date.parse(end)-Date.parse(start)>31*24*HOUR)throw Error('单次查询范围最多 31 天，请分段查询');
  const type=input.type||'ALL';if(!['ALL','CRASH','ANR'].includes(type))throw Error('请选择崩溃或 ANR 类型');
  const filters=[type==='ALL'?'errorIssueType = CRASH OR errorIssueType = ANR':'errorIssueType = '+type];
  for(const field of ['versionCode','apiLevel','errorIssueId'])if(input[field]!==undefined&&input[field]!==''){
    if(typeof input[field]!=='string'||!/^\d{1,19}$/.test(input[field]))throw Error(field+' 必须是数字');
    filters.push(field+' = '+input[field]);
  }
  const pageSize=input.pageSize??50;if(!Number.isInteger(pageSize)||pageSize<1||pageSize>100)throw Error('每页报告数必须为 1–100');
  if(input.pageToken!==undefined&&(typeof input.pageToken!=='string'||input.pageToken.length>8192))throw Error('分页参数无效');
  const params=new URLSearchParams({pageSize:String(pageSize),filter:filters.join(' AND ')});
  for(const [key,value]of [['startTime',start],['endTime',end]]){const d=new Date(value);for(const [part,n]of Object.entries({year:d.getUTCFullYear(),month:d.getUTCMonth()+1,day:d.getUTCDate(),hours:d.getUTCHours()}))params.set('interval.'+key+'.'+part,String(n));params.set('interval.'+key+'.timeZone.id','UTC');}
  if(input.pageToken)params.set('pageToken',input.pageToken);
  return {params,interval:{startTime:new Date(start).toISOString(),endTime:new Date(end).toISOString()}};
}
function createReporting({accessToken,fetchImpl=fetch,now=()=>Date.now()}){
  const pending=new Map(),cooldowns=new Map();
  async function search(profile,input){
    if(!profile?.id||!/^\w+(?:\.\w+)+$/.test(profile.packageName||''))throw Error('请选择有效的 Google Play 应用');
    const q=query(input,now()),identity=JSON.stringify([profile.id,profile.packageName,profile.credentialPath,profile.credentialFile]);
    if((cooldowns.get(identity)||0)>now())throw Error('Reporting API 配额受限，请在 '+new Date(cooldowns.get(identity)).toISOString()+' 后重试');
    const key=identity+q.params.toString();if(pending.has(key))return pending.get(key);
    const task=(async()=>{
      const token=await accessToken(SCOPE,profile);let response;
      try{response=await fetchImpl('https://playdeveloperreporting.googleapis.com/v1beta1/apps/'+encodeURIComponent(profile.packageName)+'/errorReports:search?'+q.params,{headers:{Authorization:'Bearer '+token},signal:AbortSignal.timeout(45000),redirect:'error'});}catch{throw Error('Reporting API 连接失败或超时，请检查网络后手动重试');}
      let value;try{value=await response.json();}catch{throw Error('Reporting API 返回无效响应，HTTP '+response.status);}
      if(!value||typeof value!=='object'||Array.isArray(value))throw Error('Reporting API 返回无效响应');
      if(!response.ok){
        const error=value.error||{},quota=response.status===429||/quota|rate.?limit|resource.?exhausted/i.test(error.message||'');
        if(quota){const retry=Number(response.headers.get('retry-after'));const delay=Number.isFinite(retry)&&retry>0?Math.max(60,Math.min(retry,3600)):60;cooldowns.set(identity,now()+delay*1000);throw Error('Reporting API 配额受限，已暂停当前应用查询 '+delay+' 秒；请检查该 API 配额，不要重复点击');}
        const disabled=(error.details||[]).some(d=>d.reason==='SERVICE_DISABLED')||/has not been used|is disabled/i.test(error.message||'');
        if(disabled)throw Error('请在服务账号所属 Cloud 项目启用 Google Play Developer Reporting API，再重试');
        if(response.status===403)throw Error('Reporting API 访问被拒绝：请确认已启用此 API，并在 Play Console 为服务账号授予目标应用的“查看应用信息（只读）”权限');
        if(response.status===401)throw Error('Reporting API 授权失效，请检查当前项目服务账号凭据');
        if(response.status===404)throw Error('Reporting API 未找到此应用，请核对包名及服务账号可访问的应用');
        throw Error('Reporting API 请求失败（HTTP '+response.status+'）：'+String(error.message||'请稍后重试').slice(0,500));
      }
      if(value.errorReports!==undefined&&!Array.isArray(value.errorReports))throw Error('Reporting API 返回的报告列表无效');
      if((value.errorReports||[]).some(r=>!r||typeof r!=='object'||typeof r.name!=='string'||(r.reportText!==undefined&&typeof r.reportText!=='string')))throw Error('Reporting API 返回的报告内容无效');
      if(value.nextPageToken!==undefined&&typeof value.nextPageToken!=='string')throw Error('Reporting API 返回的分页参数无效');
      return {packageName:profile.packageName,interval:q.interval,reports:value.errorReports||[],nextPageToken:value.nextPageToken||'',fetchedAt:new Date(now()).toISOString()};
    })();pending.set(key,task);try{return await task;}finally{pending.delete(key);}
  }
  return {search};
}
module.exports={createReporting,query,SCOPE};