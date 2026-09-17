'use strict';
const http=require('node:http'), fs=require('node:fs'), path=require('node:path'), crypto=require('node:crypto');
const C=require('./core');
const Cred=require('./credentials');
const Finance=require('./finance');
const ListingsWorkbook=require('./listings-workbook');
const finance=Finance.createFinance(accessToken);
const publicSettings=()=>({profiles:settings.profiles.map(Cred.publicProfile),activeId:settings.activeId,current:Cred.publicProfile(config)});
const APP_VERSION=require('./package.json').version;
const ROOT=__dirname,DATA=process.env.GP_DATA_DIR||path.join(ROOT,'data');
fs.mkdirSync(DATA,{recursive:true});
const SCHEMAS=JSON.parse(fs.readFileSync(path.join(ROOT,'google-api-discovery.json'),'utf8')).schemas;
const PORT=Number(process.env.GP_PORT||4318),SESSION=crypto.randomBytes(32).toString('hex');
const updater=require('./updater').createUpdater({root:ROOT,data:DATA,version:APP_VERSION,port:PORT});
const desktop=require('./desktop-integration').createDesktop({root:ROOT,data:DATA,port:PORT});
const diagnostics=()=>require('./diagnostics').createDiagnostics({data:DATA,version:APP_VERSION,port:PORT,update:updater.status,desktop:desktop.status()});
const read=(name,fallback)=>{try{return JSON.parse(fs.readFileSync(path.join(DATA,name),'utf8'));}catch(e){if(e.code==='ENOENT')return fallback;throw e;}};
const save=(name,obj)=>{const dest=path.join(DATA,name);fs.writeFileSync(dest+'.tmp',JSON.stringify(obj,null,2),{mode:0o600});fs.renameSync(dest+'.tmp',dest);};
let settings=read('config.json',{profiles:[],activeId:''});
if(!settings.profiles)settings={profiles:settings.packageName?[{id:crypto.randomUUID(),name:settings.packageName,...settings}]:[],activeId:''};
if(!settings.activeId&&settings.profiles.length)settings.activeId=settings.profiles[0].id;
let config=settings.profiles.find(p=>p.id===settings.activeId)||{packageName:'',credentialPath:''},tokenCache=null,busy=false;
const plans=new Map();
function seed() {
  return [ ['coins_100','金币小礼包','100 coins','0.99','7'],['coins_550','金币超值礼包','550 coins','4.99','39'],['remove_ads','永久去广告','Remove ads','2.99','23'] ].map(([id,title,desc,usd,hkd])=>({
    packageName:'com.example.demo',productId:id,regionsVersion:{version:'demo'},
    listings:[{languageCode:'zh-CN',title,description:desc},{languageCode:'en-US',title:desc,description:desc}],
    purchaseOptions:[{purchaseOptionId:'buy',state:'ACTIVE',buyOption:{legacyCompatible:true},regionalPricingAndAvailabilityConfigs:[
      {regionCode:'US',price:C.money(usd,'USD'),availability:'AVAILABLE'},
      {regionCode:'HK',price:C.money(hkd,'HKD'),availability:'AVAILABLE'}]}]
  }));
}
let demo=read('demo.json',seed());
async function accessToken(scope='https://www.googleapis.com/auth/androidpublisher',profile=config) {
  if(!['https://www.googleapis.com/auth/androidpublisher',Finance.SCOPE].includes(scope))throw Error('授权范围无效');
  const identity=JSON.stringify([profile.id,profile.credentialFile,profile.credentialPath]);
  if(tokenCache&&tokenCache.identity===identity&&tokenCache.scope===scope&&tokenCache.expires>Date.now()+60000)return tokenCache.token;
  const key=Cred.loadCredential(DATA,profile);
  const now=Math.floor(Date.now()/1000), b64=v=>Buffer.from(JSON.stringify(v)).toString('base64url');
  const unsigned=b64({alg:'RS256',typ:'JWT'})+'.'+b64({iss:key.client_email,scope,aud:'https://oauth2.googleapis.com/token',iat:now,exp:now+3600});
  let signature;try{signature=crypto.sign('RSA-SHA256',Buffer.from(unsigned),key.private_key).toString('base64url');}catch{throw Error('服务账号私钥无效');}
  const response=await fetch('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'urn:ietf:params:oauth:grant-type:jwt-bearer',assertion:unsigned+'.'+signature}),signal:AbortSignal.timeout(30000),redirect:'error'});
  const result=await response.json();
  if(!response.ok)throw Error('Google 授权失败：'+(result.error_description||result.error||response.status));
  tokenCache={identity,scope,token:result.access_token,expires:Date.now()+Number(result.expires_in||3600)*1000};
  return tokenCache.token;
}
async function google(method,suffix,body,profile=config) {
  const token=await accessToken('https://www.googleapis.com/auth/androidpublisher',profile);
  const response=await fetch('https://androidpublisher.googleapis.com/androidpublisher/v3/applications/'+encodeURIComponent(profile.packageName)+suffix,{
    method,headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(45000),redirect:'error'});
  const raw=await response.text();let result;try{result=raw?JSON.parse(raw):{};}catch{throw Error('Google 返回非 JSON 响应，HTTP '+response.status);}
  if(!response.ok){const e=Error('Google '+response.status+'：'+(result.error?.message||'请求失败'));e.status=response.status;throw e;}
  return result;
}
const monitor=require('./review-monitor').createMonitor({file:path.join(DATA,'review-monitor.json'),profiles:()=>settings.profiles,listReleases:(profile,track)=>google('GET','/tracks/'+encodeURIComponent(track)+'/releases',undefined,profile)});
const notifications=require('./feishu-notifications').createNotifier({file:path.join(DATA,'feishu-notifications.json'),protect:Cred.protect});
async function checkReview(id){
  const result=await monitor.check(id),profile=settings.profiles.find(p=>p.id===id);
  if(profile)await notifications.process(profile,result.events);
  return result;
}
function packageFor(mode){if(!['demo','live'].includes(mode))throw Error('请选择演示或真实模式');if(mode==='demo')return 'com.example.demo';if(!config.packageName)throw Error('请先设置应用包名');return config.packageName;}
async function getProduct(mode,id) {
  if(mode==='demo')return C.clone(demo.find(p=>p.productId===id)||null);
  try{return await google('GET','/oneTimeProducts/'+encodeURIComponent(id));}catch(e){if(e.status===404)return null;throw e;}
}
async function listProducts(mode) {
  packageFor(mode);
  if(mode==='demo')return C.clone(demo);
  const result=[];let page='';
  do{
    const data=await google('GET','/oneTimeProducts?pageSize=1000'+(page?'&pageToken='+encodeURIComponent(page):''));
    result.push(...data.oneTimeProducts||[]);page=data.nextPageToken||'';
  }while(page);
  return result;
}
async function conversion(mode,price,category) {
  if(mode==='demo')throw Error('Google 地区换算需要真实授权；演示模式可试用指定价格和比例调价');
  return google('POST','/pricing:convertRegionPrices',{price,...(category?{productTaxCategoryCode:category}:{})});
}
function checkTransitions(before,after,states) {
  for(const o of after.purchaseOptions) {
    const old=before?.purchaseOptions.find(x=>x.purchaseOptionId===o.purchaseOptionId);
    if(o.state!==old?.state && o.state!==undefined)throw Error('请使用启用/停用功能修改状态；新选项创建为草稿');
    for(const r of o.regionalPricingAndAvailabilityConfigs) {
      const prior=old?.regionalPricingAndAvailabilityConfigs?.find(x=>x.regionCode===r.regionCode);
      if(r.availability==='NO_LONGER_AVAILABLE'&&!['AVAILABLE','NO_LONGER_AVAILABLE'].includes(prior?.availability))throw Error(r.regionCode+' 不能从未销售直接改为停止销售');
    }
  }
  if(before)for(const o of before.purchaseOptions)if(!after.purchaseOptions.some(x=>x.purchaseOptionId===o.purchaseOptionId))throw Error('此版本不允许移除已有购买选项');
  for(const [id,target] of Object.entries(states||{})) {
    if(!['ACTIVE','INACTIVE'].includes(target))throw Error('状态目标无效');
    const old=before?.purchaseOptions.find(o=>o.purchaseOptionId===id);
    if(!after.purchaseOptions.some(o=>o.purchaseOptionId===id))throw Error('目标购买选项不存在');
    if(target==='INACTIVE'&&!['ACTIVE','INACTIVE'].includes(old?.state))throw Error('只有已启用的购买选项可以停用');
  }
}
async function preview(body) {
  const mode=body.mode, pkg=packageFor(mode),items=body.items;
  if(!Array.isArray(items)||!items.length||items.length>500)throw Error('每次请选择 1–500 个商品');
  if(new Set(items.map(x=>x.after?.productId)).size!==items.length)throw Error('商品 ID 重复');
  const entries=[];
  let latestVersion=null;
  for(const item of items) {
    const after=C.clone(item.after);C.validate(after,SCHEMAS);
    if(after.packageName!==pkg)throw Error('商品包名与当前应用不一致');
    const before=item.before||null;
    const remote=await getProduct(mode,after.productId);
    if(!C.equal(before,remote))throw Error(after.productId+'：远端数据已改变或商品 ID 已存在。请刷新商品后重新编辑');
    const states=item.states||{};checkTransitions(before,after,states);
    const updateMask=C.mask(before,after);
    if(!updateMask.length&&!Object.keys(states).some(id=>before?.purchaseOptions.find(o=>o.purchaseOptionId===id)?.state!==states[id]))continue;
    let regionsVersion=after.regionsVersion||remote?.regionsVersion;
    if(!regionsVersion?.version){
      if(mode==='demo')regionsVersion={version:'demo'};
      else {
        if(!latestVersion)latestVersion=(await conversion(mode,C.money('1','USD'))).regionVersion;
        regionsVersion=latestVersion;
      }
    }
    if(!regionsVersion?.version)throw Error('Google 未返回地区版本，无法提交');
    entries.push({before,after,states,updateMask,regionsVersion,changes:C.changes(C.writable(before||{}),C.writable(after)).concat(Object.entries(states).filter(([id,v])=>before?.purchaseOptions.find(o=>o.purchaseOptionId===id)?.state!==v).map(([id,v])=>({path:'purchaseOptions.'+id+'.state',before:before?.purchaseOptions.find(o=>o.purchaseOptionId===id)?.state,after:v})))});
  }
  if(!entries.length)throw Error('没有需要提交的变化');
  const id=crypto.randomUUID();
  for(const [k,p] of plans)if(p.expires<Date.now())plans.delete(k);
  const plan={id,mode,packageName:pkg,configHash:C.hash(config),entries,expires:Date.now()+15*60000};
  plans.set(id,plan);
  return {id,mode,packageName:pkg,expires:plan.expires,entries};
}
function projectContains(actual,expected) {
  if(expected?.currencyCode&&actual?.currencyCode)return expected.currencyCode===actual.currencyCode&&C.decimal(expected)===C.decimal(actual);
  if(actual===undefined&&(expected===false||expected===0||Array.isArray(expected)&&!expected.length))return true;
  if(expected===undefined)return actual===undefined;
  if(expected===null||typeof expected!=='object')return C.equal(actual,expected);
  if(Array.isArray(expected)){
    if(!Array.isArray(actual)||actual.length!==expected.length)return false;
    const key=['purchaseOptionId','languageCode','regionCode','tag'].find(k=>expected.length&&expected.every(x=>x?.[k]));
    return expected.every((v,i)=>projectContains(key?actual.find(x=>x[key]===v[key]):actual[i],v));
  }
  if(!actual||typeof actual!=='object')return false;
  return Object.keys(expected).every(k=>projectContains(actual[k],expected[k]));
}
async function commit(body) {
  const plan=plans.get(body.id);
  if(!plan||plan.expires<Date.now())throw Error('预览已失效，请重新生成');
  if(body.packageName!==plan.packageName||body.mode!==plan.mode)throw Error('提交目标与预览不一致');
  if(plan.configHash!==C.hash(config))throw Error('连接设置已变化，请重新预览');
  plans.delete(plan.id);
  const record={id:plan.id,mode:plan.mode,profileId:plan.mode==='live'?config.id:null,packageName:plan.packageName,startedAt:new Date().toISOString(),entries:plan.entries,results:[]};
  const logName='operation-'+Date.now()+'-'+plan.id+'.json';
  save(logName,record);
  for(const e of plan.entries) {
    const id=e.after.productId;let wrote=false,confirmedWrite=false,stage='check';
    const steps={check:'pending',configuration:e.updateMask.length?'pending':'skipped',state:Object.keys(e.states).length?'pending':'skipped',readback:'pending'};
    try{
      const fresh=await getProduct(plan.mode,id);
      if(!C.equal(fresh,e.before))throw Error('远端已变化，未写入；请刷新后重新编辑');
      steps.check='success';
      if(plan.mode==='demo'){
        let next=C.clone(e.after);next.regionsVersion=e.regionsVersion;
        for(const o of next.purchaseOptions)o.state=e.states[o.purchaseOptionId]||e.before?.purchaseOptions.find(x=>x.purchaseOptionId===o.purchaseOptionId)?.state||'DRAFT';
        demo=demo.filter(p=>p.productId!==id);demo.push(next);save('demo.json',demo);wrote=true;
        steps.configuration=e.updateMask.length?'success':'skipped';steps.state=Object.keys(e.states).length?'success':'skipped';
      }else{
        if(e.updateMask.length){
          stage='configuration';wrote=true;
          await google('POST','/oneTimeProducts:batchUpdate',{requests:[{oneTimeProduct:C.writable(e.after),updateMask:e.updateMask.join(','),regionsVersion:e.regionsVersion,allowMissing:!e.before}]});
          confirmedWrite=true;steps.configuration='success';
        }
        const requests=Object.entries(e.states).filter(([oid,target])=>e.before?.purchaseOptions.find(o=>o.purchaseOptionId===oid)?.state!==target).map(([oid,target])=>({
          [target==='ACTIVE'?'activatePurchaseOptionRequest':'deactivatePurchaseOptionRequest']:{packageName:plan.packageName,productId:id,purchaseOptionId:oid}
        }));
        if(requests.length){stage='state';wrote=true;for(let i=0;i<requests.length;i+=100){await google('POST','/oneTimeProducts/'+encodeURIComponent(id)+'/purchaseOptions:batchUpdateStates',{requests:requests.slice(i,i+100)});confirmedWrite=true;}steps.state='success';}
      }
      stage='readback';
      const actual=await getProduct(plan.mode,id);
      const fieldsOK=e.updateMask.every(k=>projectContains(C.writable(actual||{})[k],C.writable(e.after)[k]));
      const statesOK=Object.entries(e.states).every(([oid,t])=>actual?.purchaseOptions.find(o=>o.purchaseOptionId===oid)?.state===t);
      steps.readback=fieldsOK&&statesOK?'success':'pending';
      record.results.push({productId:id,steps,status:fieldsOK&&statesOK?'verified':'pending',message:fieldsOK&&statesOK?'已提交并读回核对；购买选项：'+actual.purchaseOptions.map(o=>o.purchaseOptionId+' '+({ACTIVE:'已启用',DRAFT:'草稿（未启用）',INACTIVE:'已停用'}[o.state]||o.state)).join('、'):'已提交，读回尚未完全一致，请刷新核对后再决定是否重试',actual});
    }catch(err){
      steps[stage]=[400,401,403,404].includes(err.status)||!wrote?'failed':'uncertain';
      const rejected=!confirmedWrite&&[400,401,403,404].includes(err.status);
      const uncertain=wrote&&!rejected;
      const hint=/request billing permission/i.test(err.message)?' 处理建议：核对目标包名 '+plan.packageName+'，并检查上传到 Play Console 的应用包是否声明 com.android.vending.BILLING；这不是单纯增加服务账号管理权限可以解决的问题。':'';
      record.results.push({productId:id,steps,status:uncertain?'uncertain':'failed',message:(uncertain?'可能已部分写入，请先刷新核对。':rejected?'Google 已拒绝此请求，未写入。':'')+err.message+hint});
    }
    save(logName,record);
  }
  record.finishedAt=new Date().toISOString();save(logName,record);
  return {results:record.results,logFile:logName};
}

async function recoverOperation(b){
  if(!/^operation-[a-zA-Z0-9-]+\.json$/.test(b.logFile||''))throw Error('操作记录标识无效');
  const record=read(b.logFile,null);
  if(!record||record.mode!==b.mode||record.packageName!==packageFor(b.mode)||(b.mode==='live'&&record.profileId!==config.id))throw Error('操作记录不属于当前项目，或旧记录无法自动核对');
  const entries=[],resolved=[],blocked=[];
  for(const result of record.results.filter(r=>r.status!=='verified')){
    const e=record.entries.find(x=>x.after.productId===result.productId);if(!e)continue;
    try{
      const actual=await getProduct(b.mode,result.productId);
      const fieldsOK=actual&&e.updateMask.every(k=>projectContains(C.writable(actual)[k],C.writable(e.after)[k]));
      const remaining=Object.fromEntries(Object.entries(e.states).filter(([id,state])=>actual?.purchaseOptions.find(o=>o.purchaseOptionId===id)?.state!==state));
      if(fieldsOK){
        if(!Object.keys(remaining).length)resolved.push({productId:result.productId,actual});
        else entries.push({before:actual,after:C.clone(actual),states:remaining,reason:'配置已核对，仅补做未完成的启用/停用'});
      }else if(C.equal(actual,e.before)){
        entries.push({before:actual,after:e.after,states:e.states,reason:'远端仍与原始版本一致，可重新预览未完成操作'});
      }else blocked.push({productId:result.productId,message:'远端配置与提交前和目标版本均不一致，请手动核对；未覆盖本地草稿'});
    }catch(err){blocked.push({productId:result.productId,message:err.message});}
  }
  return {entries,resolved,blocked};
}
async function route(url,b) {
  if(url==='/api/system/status')return {version:APP_VERSION,busy,update:updater.status(),desktop:desktop.status()};
  if(url==='/api/system/diagnostics')return diagnostics();
  if(url==='/api/system/shortcuts')return desktop.shortcuts();
  if(url==='/api/system/quit'){
    setTimeout(()=>{server.close();server.closeAllConnections();if(require.main===module)process.exit(0);},300);
    return {stopping:true};
  }
  if(url==='/api/update/check')return updater.check();
  if(url==='/api/update/status')return updater.status();
  if(url==='/api/update/start')return updater.begin(b.version);
  if(url==='/api/monitor/summary')return {projects:monitor.summary()};
  if(url.startsWith('/api/monitor/')){
    const profile=settings.profiles.find(p=>p.id===b.profileId);
    if(b.mode!=='live'||!profile)throw Error('请选择有效的审核监控项目');
    if(url==='/api/monitor/feishu/status')return notifications.status(profile);
    if(url==='/api/monitor/feishu/config')return notifications.configure(profile,b);
    if(url==='/api/monitor/feishu/test')return notifications.test(profile);
    if(url==='/api/monitor/feishu/retry')return notifications.retry(profile,b.id);
    if(url==='/api/monitor/status')return monitor.status(profile.id);
    if(url==='/api/monitor/config')return monitor.configure(profile.id,b);
    if(url==='/api/monitor/check')return checkReview(profile.id);
    if(url==='/api/monitor/acknowledge')return monitor.acknowledge(profile.id);
  }
  if(b.mode==='live'&&!url.startsWith('/api/config')&&b.profileId!==config.id)throw Error('当前项目已切换，请重新选择项目并读取商品');
  if(url.startsWith('/api/finance/')){
    if(b.mode!=='live')throw Error('账单导出需要真实项目及 Google 财务权限，演示模式不提供真实账单');
    if(!config.id)throw Error('请先配置项目');
    if(url==='/api/finance/config'){
      const bucket=b.bucket?.trim()?Finance.normalizeBucket(b.bucket):'';
      const nextSettings=C.clone(settings);const next=nextSettings.profiles.find(p=>p.id===config.id);next.financialBucket=bucket;
      save('config.json',nextSettings);settings=nextSettings;config=next;plans.clear();return publicSettings();
    }
    if(!config.financialBucket)throw Error('请先保存财务报告存储桶地址');
    if(url==='/api/finance/list')return finance.list(config,b.month);
    if(url==='/api/finance/download')return {_download:await finance.download(config,b.reportId)};
  }
  if(url==='/api/recover')return recoverOperation(b);
  if(url==='/api/import/inspect'){const rows=C.parseCSV(b.csv);return {rows:rows.slice(0,8),count:rows.length};}
  if(url==='/api/config')return publicSettings();
  if(url==='/api/config/switch'){
    const next=settings.profiles.find(p=>p.id===b.id);if(!next)throw Error('项目不存在');
    settings.activeId=next.id;config=next;save('config.json',settings);tokenCache=null;plans.clear();return publicSettings();
  }
  if(url==='/api/config/save'){
    if(!/^[a-zA-Z]\w*(\.[a-zA-Z]\w*)+$/.test(b.packageName||''))throw Error('应用包名格式错误');
    if(!b.name?.trim())throw Error('请填写项目名称');
    const previous=settings.profiles.find(p=>p.id===b.id);
    if(b.id&&!previous)throw Error('项目不存在');
    if(b.credentialJson!==undefined&&typeof b.credentialJson!=='string')throw Error('请提供 JSON 文本');
    const next={...previous,id:b.id||crypto.randomUUID(),name:b.name.trim(),packageName:b.packageName};
    const imported=b.credentialJson?.trim()?Cred.storeCredential(DATA,b.credentialJson):null;
    if(imported){delete next.credentialPath;Object.assign(next,imported);}
    const nextSettings=C.clone(settings),index=nextSettings.profiles.findIndex(p=>p.id===next.id);
    if(index<0)nextSettings.profiles.push(next);else nextSettings.profiles[index]=next;
    nextSettings.activeId=next.id;
    try{save('config.json',nextSettings);}catch(e){if(imported)Cred.removeCredential(DATA,imported.credentialFile);throw Error('配置保存失败，原凭据未更改');}
    settings=nextSettings;config=next;tokenCache=null;plans.clear();
    if(imported&&previous?.credentialFile)Cred.removeCredential(DATA,previous.credentialFile);
    return publicSettings();
  }
  if(url==='/api/products')return {products:await listProducts(b.mode),packageName:packageFor(b.mode)};
  if(url==='/api/validate'){C.validate(b.product,SCHEMAS);return {valid:true};}
  if(url==='/api/import'){
    const pkg=packageFor(b.mode),existing=b.existing||[];
    if(!Array.isArray(existing)||existing.some(p=>p.packageName!==pkg))throw Error('导入范围与当前应用不符');
    const expanded=await C.expandAllRegionsCSV(b.csv,existing,(price,category)=>conversion(b.mode,price,category));
    const products=C.importCSV(expanded.csv,existing,pkg);
    for(const p of products){if(expanded.versions.has(p.productId))p.regionsVersion=expanded.versions.get(p.productId);C.validate(p,SCHEMAS);}
    return {products,allOptions:expanded.allOptions,expandedRows:expanded.expandedRows};
  }
  if(url==='/api/listings/import'){
    const pkg=packageFor(b.mode);
    if(!Array.isArray(b.existing)||b.existing.some(p=>p.packageName!==pkg))throw Error('商品范围与当前项目不符');
    const result=b.xlsx?ListingsWorkbook.importWorkbook(ListingsWorkbook.decode(b.xlsx),b.existing):{products:C.importListingsCSV(b.csv,b.existing)};result.products.forEach(p=>C.validate(p,SCHEMAS));return result;
  }
  if(url==='/api/listings/inspect-xlsx'){const result=ListingsWorkbook.readWorkbook(ListingsWorkbook.decode(b.xlsx));return {count:result.rows.length,sheets:result.sheets,preview:result.rows.slice(0,8)};}
  if(url==='/api/listings/template'){
    if(b.format==='xlsx')return {_download:{bytes:ListingsWorkbook.exportWorkbook(b.products||[],b.languages||[]),name:'gp-multilingual-template.xlsx',type:ListingsWorkbook.MIME}};
    return {csv:C.exportListingsCSV(b.products||[],b.languages||[])};
  }
  if(url==='/api/export')return {csv:C.exportCSV(b.products||[])};
  if(url==='/api/adjust'){
    const products=C.clone(b.products||[]);let count=0;
    if(!Array.isArray(b.regions)||!b.regions.length)throw Error('请指定地区');
    if(b.kind==='fixed'&&!/^[A-Z]{3}$/.test(b.currency||''))throw Error('指定价格必须选择币种');
    for(const p of products)for(const o of p.purchaseOptions) {
      if(b.optionId&&o.purchaseOptionId!==b.optionId)continue;
      for(const r of o.regionalPricingAndAvailabilityConfigs||[]){
        if(!b.regions.includes(r.regionCode)||(b.currency&&r.price.currencyCode!==b.currency))continue;
        r.price=C.adjust(r.price,b.kind,b.value);count++;
      }
    }
    if(!count)throw Error('没有匹配的地区、币种或购买选项');
    return {products,count};
  }
  if(url==='/api/convert'){
    const result=await conversion(b.mode,C.money(b.price,b.currency),b.productTaxCategoryCode);return result;
  }
  if(url==='/api/preview')return preview(b);
  if(url==='/api/commit')return commit(b);
  if(url==='/api/history'){
    const names=fs.readdirSync(DATA).filter(n=>/^operation-.*\.json$/.test(n)).sort().reverse().slice(0,30);
    return {operations:names.map(n=>{const r=read(n,{});return {file:n,mode:r.mode,packageName:r.packageName,startedAt:r.startedAt,results:r.results};})};
  }
  throw Error('未知接口');
}
function send(res,status,data,type='application/json; charset=utf-8') {
  res.writeHead(status,{'Content-Type':type,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",'Referrer-Policy':'no-referrer'});
  res.end(type.startsWith('application/json')?JSON.stringify(data):data);
}
const server=http.createServer(async(req,res)=>{
  const host=req.headers.host;
  if(!['127.0.0.1:'+PORT,'localhost:'+PORT].includes(host))return send(res,403,{error:'禁止此 Host'});
  if(req.headers.origin&&!['http://127.0.0.1:'+PORT,'http://localhost:'+PORT].includes(req.headers.origin))return send(res,403,{error:'禁止跨站访问'});
  const url=new URL(req.url,'http://'+host).pathname;
  if(req.method==='GET'&&url==='/api/session')return send(res,200,{token:SESSION,application:'gp-product-workbench',version:APP_VERSION});
  if(req.method==='GET'&&['/','/app.js','/style.css'].includes(url)){
    const file=url==='/'?'index.html':url.slice(1),type=file.endsWith('.html')?'text/html':file.endsWith('.js')?'text/javascript':'text/css';
    return send(res,200,fs.readFileSync(path.join(ROOT,'public',file)),type+'; charset=utf-8');
  }
  if(req.method!=='POST'||req.headers['x-gp-token']!==SESSION)return send(res,403,{error:'请从本机工具页面操作'});
  if(!(req.headers['content-type']||'').startsWith('application/json'))return send(res,415,{error:'需要 JSON'});
  // Support reads remain available while an update or business operation runs.
  if(['/api/system/status','/api/system/diagnostics'].includes(url)){
    try{return send(res,200,await route(url,{}));}catch(e){return send(res,400,{error:e.message});}
  }
  if(updater.isActive()&&url!=='/api/update/status')return send(res,409,{error:'正在更新，请等待重启完成'});
  if(busy)return send(res,409,{error:'正在处理另一项操作，请稍后重试'});
  let text='';try{
    for await(const chunk of req){text+=chunk;if(Buffer.byteLength(text)>8*1024*1024)throw Error('请求超过 8MB，请分批处理');}
    const body=JSON.parse(text||'{}');
    // Recheck after asynchronous request parsing to serialize mutations.
    if(updater.isActive()&&url!=='/api/update/status')return send(res,409,{error:'正在更新，请等待重启完成'});
    if(busy)return send(res,409,{error:'正在处理另一项操作，请稍后重试'});
    busy=true;
    try{
      const result=await route(url,body);
      if(result?._download){
        const file=result._download;
        res.writeHead(200,{'Content-Type':file.type||(file.name.endsWith('.zip')?'application/zip':'text/csv'),'Content-Disposition':'attachment; filename="'+file.name+'"','Content-Length':file.bytes.length,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','X-File-SHA256':file.sha256||crypto.createHash('sha256').update(file.bytes).digest('hex')});
        res.end(file.bytes);
      }else send(res,200,result);
    }finally{busy=false;}
  }catch(e){send(res,400,{error:e.message});}
});
if(require.main===module){
  server.listen(PORT,'127.0.0.1',()=>console.log('GP Product Workbench: http://127.0.0.1:'+PORT));
  let monitorChecking=false;
  const monitorTimer=setInterval(async()=>{
    if(busy||monitorChecking||updater.isActive())return;
    const id=monitor.due();if(!id)return;
    monitorChecking=true;try{await checkReview(id);}catch(e){console.error('Review monitor:',e.message);}finally{monitorChecking=false;}
  },30000);monitorTimer.unref();server.on('close',()=>clearInterval(monitorTimer));
}
module.exports={server,projectContains,checkTransitions};
