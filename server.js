'use strict';
const http=require('node:http'), fs=require('node:fs'), path=require('node:path'), crypto=require('node:crypto');
const C=require('./core');
const Cred=require('./credentials');
const Finance=require('./finance');
const ListingsWorkbook=require('./listings-workbook');
const publicSettings=()=>({profiles:settings.profiles.map(Cred.publicProfile),activeId:settings.activeId,current:Cred.publicProfile(config)});
const APP_VERSION=require('./package.json').version;
const ROOT=__dirname,DATA=process.env.GP_DATA_DIR||path.join(ROOT,'data');
fs.mkdirSync(DATA,{recursive:true});
const SCHEMAS=JSON.parse(fs.readFileSync(path.join(ROOT,'google-api-discovery.json'),'utf8')).schemas;
const PORT=Number(process.env.GP_PORT||4318),SESSION=crypto.randomBytes(32).toString('hex');
const updater=require('./updater').createUpdater({root:ROOT,data:DATA,version:APP_VERSION,port:PORT});
const desktop=require('./desktop-integration').createDesktop({root:ROOT,data:DATA,port:PORT});
const diagnostics=()=>require('./diagnostics').createDiagnostics({data:DATA,version:APP_VERSION,port:PORT,update:updater.status,desktop:desktop.status()});
const {read,save}=require('./json-store').createJsonStore(DATA);
const apple=require('./apple-workspace').createAppleWorkspace({data:DATA,read,save});
let settings=read('config.json',{profiles:[],activeId:''});
if(!settings.profiles)settings={profiles:settings.packageName?[{id:crypto.randomUUID(),name:settings.packageName,...settings}]:[],activeId:''};
if(!settings.activeId&&settings.profiles.length)settings.activeId=settings.profiles[0].id;
let config=settings.profiles.find(p=>p.id===settings.activeId)||{packageName:'',credentialPath:''},busy=false;
const googleClient=require('./google-client').createGoogleClient({getProfile:()=>config,loadCredential:profile=>Cred.loadCredential(DATA,profile)});
const {accessToken,request:google}=googleClient;
const finance=Finance.createFinance(accessToken);
const products=require('./google-products').createGoogleProducts({getProfile:()=>config,google,read,save,schemas:SCHEMAS});
const {packageFor,listProducts,conversion,preview,commit,recoverOperation}=products;
const {projectContains,checkTransitions}=require('./google-product-rules');
const monitor=require('./review-monitor').createMonitor({file:path.join(DATA,'review-monitor.json'),profiles:()=>settings.profiles,listReleases:(profile,track)=>google('GET','/tracks/'+encodeURIComponent(track)+'/releases',undefined,profile)});
const notifications=require('./feishu-notifications').createNotifier({file:path.join(DATA,'feishu-notifications.json'),protect:Cred.protect});
async function checkReview(id){
  const result=await monitor.check(id),profile=settings.profiles.find(p=>p.id===id);
  if(profile)await notifications.process(profile,result.events);
  return result;
}
const workspaceProjects=require('./workspace-projects').createWorkspaceProjects({read,save,googleProfiles:()=>publicSettings().profiles,appleProfiles:()=>apple.publicSettings().profiles});
async function route(url,b) {
  if(url==='/api/projects')return workspaceProjects.snapshot();
  if(url==='/api/projects/save')return workspaceProjects.update(b);
  if(url.startsWith('/api/apple/'))return apple.route(url,b);
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
      save('config.json',nextSettings);settings=nextSettings;config=next;products.invalidate();return publicSettings();
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
    settings.activeId=next.id;config=next;save('config.json',settings);googleClient.invalidate();products.invalidate();return publicSettings();
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
    settings=nextSettings;config=next;googleClient.invalidate();products.invalidate();
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
  if(req.method==='GET'&&['/','/app.js','/style.css','/apple.html','/apple.js','/workspace-shell.js','/system-tools.js','/playbatch-icon-v1.png'].includes(url)){
    const file=url==='/'?'index.html':url.slice(1),type=file.endsWith('.png')?'image/png':file.endsWith('.html')?'text/html':file.endsWith('.js')?'text/javascript':'text/css';
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
