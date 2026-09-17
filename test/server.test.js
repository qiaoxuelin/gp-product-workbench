const {test}=require('node:test');
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'gp-test-'));
process.env.GP_DATA_DIR=tmp;process.env.GP_PORT='14319';
const {server,projectContains}=require('../server'),C=require('../core');
test('HTTP integration: demo lifecycle, CSRF, multi-project isolation, live adapter requests and uncertain writes',async t=>{
  await new Promise(r=>server.listen(14319,'127.0.0.1',r));
  assert(projectContains({currencyCode:'USD',units:'1'},{currencyCode:'USD',units:'1',nanos:0}));
  assert(projectContains({}, {multiQuantityEnabled:false}));
  assert(!projectContains(undefined,{}));
  const nativeFetch=global.fetch;
  t.after(async()=>{global.fetch=nativeFetch;await new Promise(r=>server.close(r));fs.rmSync(tmp,{recursive:true,force:true});});
  const root='http://127.0.0.1:14319';
  let r=await nativeFetch(root+'/api/session');const token=(await r.json()).token;
  const call=async(url,body={},expected=200)=>{
    const response=await nativeFetch(root+'/api/'+url,{method:'POST',headers:{'Content-Type':'application/json','X-GP-Token':token},body:JSON.stringify(body)});
    const result=await response.json();assert.equal(response.status,expected,JSON.stringify(result));return result;
  };
  r=await nativeFetch(root+'/api/products',{method:'POST',headers:{'Content-Type':'application/json'},body:'{"mode":"demo"}'});assert.equal(r.status,403);
  r=await nativeFetch(root+'/api/session',{headers:{Origin:'https://evil.example'}});assert.equal(r.status,403);
  let data=await call('products',{mode:'demo'});const before=data.products[0],after=C.clone(before);
  after.purchaseOptions[0].regionalPricingAndAvailabilityConfigs[0].price=C.money('1.99','USD');
  let plan=await call('preview',{mode:'demo',items:[{before,after}]});
  let result=await call('commit',{mode:'demo',packageName:plan.packageName,id:plan.id});
  assert.equal(result.results[0].status,'verified');
  assert.deepEqual(result.results[0].actual.purchaseOptions[0].regionalPricingAndAvailabilityConfigs[1],before.purchaseOptions[0].regionalPricingAndAvailabilityConfigs[1]);
  await call('commit',{mode:'demo',packageName:plan.packageName,id:plan.id},400);
  await call('preview',{mode:'demo',items:[{before,after}]},400);
  const fresh=result.results[0].actual,newP=C.clone(fresh);newP.productId='new_product';delete newP.regionsVersion;delete newP.purchaseOptions[0].state;
  plan=await call('preview',{mode:'demo',items:[{before:null,after:newP}]});
  result=await call('commit',{mode:'demo',packageName:plan.packageName,id:plan.id});assert.equal(result.results[0].actual.purchaseOptions[0].state,'DRAFT');
  const created=result.results[0].actual;
  plan=await call('preview',{mode:'demo',items:[{before:created,after:created,states:{buy:'ACTIVE'}}]});
  result=await call('commit',{mode:'demo',packageName:plan.packageName,id:plan.id});assert.equal(result.results[0].actual.purchaseOptions[0].state,'ACTIVE');
  const kp=crypto.generateKeyPairSync('rsa',{modulusLength:2048}),keyfile=path.join(tmp,'test-key.json');
  fs.writeFileSync(keyfile,JSON.stringify({type:'service_account',client_email:'test@example.iam.gserviceaccount.com',private_key:kp.privateKey.export({type:'pkcs8',format:'pem'})}));
  const a=await call('config/save',{name:'App A',packageName:'com.test.a',credentialJson:fs.readFileSync(keyfile,'utf8')});
  const b=await call('config/save',{name:'App B',packageName:'com.test.b',credentialJson:fs.readFileSync(keyfile,'utf8')});
  assert.notEqual(a.activeId,b.activeId);assert.equal(b.profiles.length,2);
  assert.equal(a.current.hasCredential,true);
  assert.equal(a.current.credentialEmail,'test@example.iam.gserviceaccount.com');
  assert(!JSON.stringify(a).includes('PRIVATE KEY'));
  assert(!JSON.stringify(a).includes('credentialFile'));
  const stored=JSON.parse(fs.readFileSync(path.join(tmp,'config.json'),'utf8'));
  assert(stored.profiles.every(p=>p.credentialFile.endsWith('.dpapi')));
  assert(!fs.readFileSync(path.join(tmp,stored.profiles[0].credentialFile),'utf8').includes('PRIVATE KEY'));
  await call('config/save',{id:a.activeId,name:'App A',packageName:'com.test.a',credentialJson:'bad json'},400);
  let retained=await call('config/save',{id:a.activeId,name:'App A renamed',packageName:'com.test.a'});
  assert.equal(retained.current.credentialEmail,a.current.credentialEmail);
  const replacement=JSON.parse(fs.readFileSync(keyfile,'utf8'));replacement.client_email='replacement@example.iam.gserviceaccount.com';
  let replaced=await call('config/save',{id:a.activeId,name:'App A',packageName:'com.test.a',credentialJson:JSON.stringify(replacement)});
  assert.equal(replaced.current.credentialEmail,replacement.client_email);
  assert(!fs.existsSync(path.join(tmp,stored.profiles[0].credentialFile)));
  await call('config/switch',{id:b.activeId});
  await call('products',{mode:'live',profileId:a.activeId},400);
  await call('config/switch',{id:a.activeId});
  let remote={...C.clone(before),packageName:'com.test.a',regionsVersion:{version:'2022/02'}};
  const calls=[];let failWrite=false;
  global.fetch=async(url,options={})=>{
    if(String(url).startsWith(root))return nativeFetch(url,options);
    calls.push({url:String(url),options,body:options.body&&typeof options.body==='string'?JSON.parse(options.body):null});
    if(String(url)==='https://oauth2.googleapis.com/token')return Response.json({access_token:'fake-test-token',expires_in:3600});
    assert.match(options.headers.Authorization,/Bearer fake-test-token/);
    if(String(url).includes(':batchUpdate')){
      if(failWrite==='billing')return Response.json({error:{message: "Can't create product. To fix, request billing permission."}},{status:400});
      if(failWrite)throw Error('simulated connection interruption');
      const body=JSON.parse(options.body),q=body.requests[0];
      assert.deepEqual(q.regionsVersion,{version:'2022/02'});
      assert.equal(q.updateMask,'purchaseOptions');
      assert.equal(q.oneTimeProduct.purchaseOptions[0].state,undefined);
      assert.equal(q.oneTimeProduct.regionsVersion,undefined);
      remote={...q.oneTimeProduct,regionsVersion:q.regionsVersion};
      remote.purchaseOptions[0].state='ACTIVE';return Response.json({oneTimeProducts:[remote]});
    }
    if(String(url).includes('/pricing:convertRegionPrices'))return Response.json({regionVersion:{version:'2025/03'},convertedRegionPrices:{US:{price:C.money('1.99','USD')},JP:{price:C.money('300','JPY')}}});
    if(String(url).includes('/oneTimeProducts/'))return Response.json(remote);
    if(String(url).includes('/oneTimeProducts?'))return Response.json({oneTimeProducts:[remote]});
    throw Error('Unexpected Google endpoint '+url);
  };
  const csvImport=await call('import',{mode:'live',profileId:a.activeId,existing:[],csv:'productId,purchaseOptionId,languageCode,title,description,regionCode,currencyCode,price,availability\nall_regions,buy,en-US,All regions,Test product,ALL,USD,1.99,AVAILABLE'});
  assert.equal(csvImport.allOptions,1);
  assert.equal(csvImport.products[0].purchaseOptions[0].regionalPricingAndAvailabilityConfigs.length,2);
  assert.equal(csvImport.products[0].regionsVersion.version,'2025/03');
  const liveBefore=C.clone(remote),liveAfter=C.clone(remote);liveAfter.purchaseOptions[0].regionalPricingAndAvailabilityConfigs[0].price=C.money('3.99','USD');
  plan=await call('preview',{mode:'live',profileId:a.activeId,items:[{before:liveBefore,after:liveAfter}]});
  result=await call('commit',{mode:'live',profileId:a.activeId,packageName:'com.test.a',id:plan.id});
  assert.equal(result.results[0].status,'verified');assert(calls.some(c=>c.url.endsWith('oneTimeProducts:batchUpdate')));
  let next=C.clone(remote);next.purchaseOptions[0].regionalPricingAndAvailabilityConfigs[0].price=C.money('4.99','USD');
  plan=await call('preview',{mode:'live',profileId:a.activeId,items:[{before:remote,after:next}]});
  await call('config/switch',{id:b.activeId});
  await call('commit',{mode:'live',profileId:a.activeId,packageName:'com.test.a',id:plan.id},400);
  await call('config/switch',{id:a.activeId});
  plan=await call('preview',{mode:'live',profileId:a.activeId,items:[{before:remote,after:next}]});
  failWrite=true;result=await call('commit',{mode:'live',profileId:a.activeId,packageName:'com.test.a',id:plan.id});
  assert.equal(result.results[0].status,'uncertain');
  plan=await call('preview',{mode:'live',profileId:a.activeId,items:[{before:remote,after:next}]});
  failWrite='billing';result=await call('commit',{mode:'live',profileId:a.activeId,packageName:'com.test.a',id:plan.id});
  assert.equal(result.results[0].status,'failed');
  assert.match(result.results[0].message,/com.android.vending.BILLING/);

  { const previousMock=global.fetch;let created=null,activationError=false;const order=[];
  const freshProduct=C.clone(next);freshProduct.productId='create_and_activate';delete freshProduct.purchaseOptions[0].state;
  global.fetch=async(url,options={})=>{
    if(String(url).endsWith('/oneTimeProducts:batchUpdate')){
      const body=JSON.parse(options.body);assert.equal(body.requests[0].allowMissing,true);
      created={...body.requests[0].oneTimeProduct,regionsVersion:body.requests[0].regionsVersion};
      created.purchaseOptions[0].state='DRAFT';order.push('create');return Response.json({oneTimeProducts:[created]});
    }
    if(String(url).endsWith('/create_and_activate/purchaseOptions:batchUpdateStates')){
      assert(created);assert.equal(created.purchaseOptions[0].state,'DRAFT');
      assert.deepEqual(JSON.parse(options.body).requests[0].activatePurchaseOptionRequest,{packageName:'com.test.a',productId:'create_and_activate',purchaseOptionId:created.purchaseOptions[0].purchaseOptionId});
      if(activationError)return Response.json({error:{message:'activation denied'}},{status:403});
      created.purchaseOptions[0].state='ACTIVE';order.push('activate');return Response.json({oneTimeProducts:[created]});
    }
    if(String(url).endsWith('/oneTimeProducts/create_and_activate'))return created?Response.json(created):Response.json({error:{message:'not found'}},{status:404});
    return previousMock(url,options);
  };
  plan=await call('preview',{mode:'live',profileId:a.activeId,items:[{before:null,after:freshProduct,states:{[freshProduct.purchaseOptions[0].purchaseOptionId]:'ACTIVE'}}]});
  result=await call('commit',{mode:'live',profileId:a.activeId,packageName:'com.test.a',id:plan.id});
  assert.deepEqual(order,['create','activate']);assert.equal(result.results[0].status,'verified');
  assert.equal(result.results[0].actual.purchaseOptions[0].state,'ACTIVE');
  created=null;order.length=0;activationError=true;
  plan=await call('preview',{mode:'live',profileId:a.activeId,items:[{before:null,after:freshProduct,states:{[freshProduct.purchaseOptions[0].purchaseOptionId]:'ACTIVE'}}]});
  result=await call('commit',{mode:'live',profileId:a.activeId,packageName:'com.test.a',id:plan.id});
  assert.equal(result.results[0].steps.configuration,'success');assert.equal(result.results[0].steps.state,'failed');
  const logFile=result.logFile;
  const originalCreated=C.clone(created);created.listings[0].title='Changed elsewhere';
  let recovery=await call('recover',{mode:'live',profileId:a.activeId,logFile});
  assert.equal(recovery.blocked.length,1);assert.equal(recovery.entries.length,0);
  created=originalCreated;
  recovery=await call('recover',{mode:'live',profileId:a.activeId,logFile});
  assert.equal(recovery.entries.length,1);assert.deepEqual(C.mask(recovery.entries[0].before,recovery.entries[0].after),[]);
  assert.equal(recovery.entries[0].states[created.purchaseOptions[0].purchaseOptionId],'ACTIVE');
  activationError=false;
  plan=await call('preview',{mode:'live',profileId:a.activeId,items:recovery.entries});
  result=await call('commit',{mode:'live',profileId:a.activeId,packageName:'com.test.a',id:plan.id});
  assert.equal(result.results[0].status,'verified');assert.deepEqual(order,['create','activate']);
  recovery=await call('recover',{mode:'live',profileId:a.activeId,logFile});
  assert.equal(recovery.resolved.length,1);assert.equal(recovery.entries.length,0);
  await call('recover',{mode:'live',profileId:a.activeId,logFile:'../config.json'},400);


  }

  {
    const saved=await call('finance/config',{mode:'live',profileId:a.activeId,bucket:'gs://pubsite_prod_rev_finance/earnings/'});
    assert.equal(saved.current.financialBucket,'pubsite_prod_rev_finance');
    const fallback=global.fetch,payload=Buffer.from('sample-report');
    let financialScope=false;
    global.fetch=async(url,options={})=>{
      if(String(url)==='https://oauth2.googleapis.com/token'){
        const jwt=new URLSearchParams(options.body).get('assertion'),claims=JSON.parse(Buffer.from(jwt.split('.')[1],'base64url'));
        financialScope=claims.scope==='https://www.googleapis.com/auth/devstorage.read_only';
        return Response.json({access_token:'finance-token',expires_in:3600});
      }
      if(String(url).startsWith('https://storage.googleapis.com/')){
        if(String(url).includes('alt=media'))return new Response(payload);
        return Response.json({items:[{name:'earnings/earnings_202608.zip',size:String(payload.length),generation:'55',md5Hash:crypto.createHash('md5').update(payload).digest('base64')}]});
      }
      return fallback(url,options);
    };
    const files=await call('finance/list',{mode:'live',profileId:a.activeId,month:'2026-08'});
    assert.equal(financialScope,true);assert.equal(files.files.length,1);
    const dl=await nativeFetch(root+'/api/finance/download',{method:'POST',headers:{'Content-Type':'application/json','X-GP-Token':token},body:JSON.stringify({mode:'live',profileId:a.activeId,reportId:files.files[0].id})});
    assert.equal(dl.status,200);assert.equal(dl.headers.get('content-type'),'application/zip');
    assert.deepEqual(Buffer.from(await dl.arrayBuffer()),payload);
    await call('finance/list',{mode:'demo',month:'2026-08'},400);
    await call('config/switch',{id:b.activeId});
    await call('finance/download',{mode:'live',profileId:a.activeId,reportId:files.files[0].id},400);
    await call('config/switch',{id:a.activeId});
  }

  {
    let state='IN_REVIEW',issuer='';
    const requests=[];
    global.fetch=async(url,options={})=>{
      if(String(url)==='https://oauth2.googleapis.com/token'){
        const jwt=new URLSearchParams(options.body).get('assertion');
        const claims=JSON.parse(Buffer.from(jwt.split('.')[1],'base64url'));
        assert.equal(claims.scope,'https://www.googleapis.com/auth/androidpublisher');issuer=claims.iss;
        return Response.json({access_token:'review-token',expires_in:3600});
      }
      requests.push([String(url),options.method,issuer]);
      return Response.json({releases:[{releaseName:'1.0',activeArtifacts:[{versionCode:10}],releaseLifecycleState:'RELEASE_LIFECYCLE_STATE_'+state}]});
    };
    await call('monitor/config',{mode:'live',profileId:a.activeId,enabled:true,tracks:['production'],intervalMinutes:5});
    let review=await call('monitor/check',{mode:'live',profileId:a.activeId});assert.equal(review.events.length,0);
    state='APPROVED_NOT_PUBLISHED';
    review=await call('monitor/check',{mode:'live',profileId:a.activeId});assert.equal(review.events.length,1);
    assert.equal(requests[0][0],'https://androidpublisher.googleapis.com/androidpublisher/v3/applications/com.test.a/tracks/production/releases');
    assert(requests.every(r=>r[1]==='GET'));assert.equal(requests[0][2],'replacement@example.iam.gserviceaccount.com');
    await call('monitor/check',{mode:'live',profileId:b.activeId});
    assert.equal(requests.at(-1)[0],'https://androidpublisher.googleapis.com/androidpublisher/v3/applications/com.test.b/tracks/production/releases');
    assert.equal(requests.at(-1)[2],'test@example.iam.gserviceaccount.com');
    await call('monitor/status',{mode:'live',profileId:a.activeId});
    assert.equal((await call('config')).activeId,a.activeId);
    await call('monitor/status',{mode:'live',profileId:'missing'},400);
    await call('products',{mode:'live',profileId:b.activeId},400);
    const notify=await call('monitor/feishu/status',{mode:'live',profileId:b.activeId});assert.equal(notify.enabled,false);
    await call('monitor/check',{mode:'demo'},400);
  }

  const history=await call('history');assert(history.operations.length>=5);
});
