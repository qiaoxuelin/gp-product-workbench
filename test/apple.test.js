'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const P=require('../apple-products'),{createAppleClient}=require('../apple-client'),{createAppleWorkspace}=require('../apple-workspace');
const profile={id:'apple-a',appId:'123456',bundleId:'com.test.apple',keyId:'ABCDEFGHIJ',issuerId:'12345678-1234-1234-1234-123456789abc',credentialFile:'fake'};
const target=()=>({productId:'coins.100',name:'Coins 100',inAppPurchaseType:'CONSUMABLE',reviewNote:'',localizations:[{locale:'en-US',name:'100 Coins',description:'Receive 100 coins'}]});
function harness(){
 const storage=new Map(),rows=new Map(),calls=[];let failLocale=false,mismatch=false,serial=0;
 const read=(k,f)=>storage.has(k)?structuredClone(storage.get(k)):f,save=(k,v)=>storage.set(k,structuredClone(v));
 const resource=p=>({id:p.id,attributes:{productId:p.productId,name:p.name,inAppPurchaseType:p.inAppPurchaseType,reviewNote:p.reviewNote,state:'MISSING_METADATA'}});
 const client={invalidate(){},async request(p,method,url,body){
  calls.push({method,url,body});
  if(method==='GET'&&url.startsWith('/v1/apps/'))return {data:{attributes:{bundleId:mismatch?'com.wrong':p.bundleId}}};
  if(method==='GET'&&url.startsWith('/v1/territories/')){const e=Error("The resource 'territories' does not allow 'GET_INSTANCE'. Allowed operation is: GET_COLLECTION");e.status=403;throw e;}
  if(method==='GET'&&url.includes('/iapPriceSchedule')){const row=[...rows.values()].find(x=>url.includes('/'+x.id+'/'));if(!row.schedule){const e=Error('no price');e.status=404;throw e;}return {data:{id:row.id,relationships:{baseTerritory:{data:{id:'USA'}}}}};}
  if(method==='POST'&&url==='/v2/inAppPurchases'){assert.deepEqual(body.data.relationships.app.data,{type:'apps',id:p.appId});const row={id:String(++serial),...body.data.attributes,localizations:[],version:null};rows.set(row.productId,row);return {data:resource(row)};}
  if(method==='PATCH'&&url.startsWith('/v2/inAppPurchases/')){const row=[...rows.values()].find(x=>url.endsWith('/'+x.id));Object.assign(row,body.data.attributes);return {data:resource(row)};}
  if(method==='POST'&&url==='/v1/inAppPurchaseVersions'){const row=[...rows.values()].find(x=>x.id===body.data.relationships.inAppPurchase.data.id);row.version={id:'v'+row.id,attributes:{version:1,state:'PREPARE_FOR_SUBMISSION'}};return {data:row.version};}
  if(url.startsWith('/v2/inAppPurchaseLocalizations')){
   if(failLocale)throw Error('simulated network timeout');
   let row;if(method==='POST'){row=[...rows.values()].find(x=>x.version.id===body.data.relationships.version.data.id);row.localizations.push({id:'l'+(++serial),attributes:{...body.data.attributes}});}else{row=[...rows.values()].find(x=>x.localizations.some(l=>url.endsWith('/'+l.id)));Object.assign(row.localizations.find(l=>url.endsWith('/'+l.id)).attributes,body.data.attributes);}return {data:{id:'localization'}};
  }
  if(method==='POST'&&url==='/v1/inAppPurchasePriceSchedules'){const row=[...rows.values()].find(x=>x.id===body.data.relationships.inAppPurchase.data.id);assert.equal(body.included[0].relationships.inAppPurchasePricePoint.data.id,'point-099');row.schedule=true;return {data:{id:row.id}};}
  throw Error('unexpected request '+method+' '+url);
 },async list(p,url){
  calls.push({method:'GET',url});const u=new URL(url,'https://test');
  if(u.pathname==='/v1/territories'){assert.equal(u.searchParams.get('limit'),'200');return [{id:'CHN',attributes:{currency:'CNY'}},{id:'USA',attributes:{currency:'USD'}}];}
  if(url.includes('/inAppPurchasesV2')){const id=u.searchParams.get('filter[productId]');return [...rows.values()].filter(x=>!id||x.productId===id).map(resource);}
  const row=[...rows.values()].find(x=>url.includes('/'+x.id+'/')||url.includes('/v'+x.id+'/'));
  if(url.includes('/versions?'))return row.version?[row.version]:[];
  if(url.includes('/localizations?')||url.includes('/inAppPurchaseLocalizations?'))return row.localizations;
  if(url.includes('/pricePoints?'))return [{id:'point-099',attributes:{customerPrice:'0.99'}}];
  if(url.includes('/manualPrices?'))return [{id:'price',attributes:{startDate:null,endDate:null},relationships:{inAppPurchasePricePoint:{data:{id:'point-099'}},territory:{data:{id:'USA'}}}}];
  throw Error('unexpected list '+url);
 }};
 return {service:P.createAppleProducts({client,read,save}),client,read,save,rows,calls,failLocale:v=>{failLocale=v;},mismatch:()=>{mismatch=true;}};
}
test('Apple CSV merges locales, rejects subscriptions and Google formats, and preserves omitted metadata',()=>{
 const a=target();a.reviewNote='retain';
 const csv='productId,name,inAppPurchaseType,locale,displayName,description\ncoins.100,Coins 100,CONSUMABLE,zh-Hans,100金币,获得100金币';
 const result=P.importCSV(csv,[a]);assert.equal(result[0].localizations.length,2);assert.equal(result[0].reviewNote,'retain');assert.deepEqual(P.importCSV(P.exportCSV(result)),result);
 assert.throws(()=>P.validate({...a,inAppPurchaseType:'NON_RENEWING_SUBSCRIPTION'}),/仅支持/);
 assert.throws(()=>P.validate({...a,localizations:[{locale:'en-US',name:'N',description:'x'}]}),/2–30/);
 assert.throws(()=>P.importCSV('productId,purchaseOptionId\na,b'),/不支持的列：purchaseOptionId/);
 assert.throws(()=>P.importCSV(csv+'\ncoins.100,Other,CONSUMABLE,en-US,Coins,More'),/不一致/);
});
test('Apple JWT uses P-256 P1363, isolates profiles, blocks credential forwarding and paginates',async()=>{
 const pair=crypto.generateKeyPairSync('ec',{namedCurve:'prime256v1'}),privateKey=pair.privateKey.export({type:'pkcs8',format:'pem'});let loads=0;const seen=[];
 const client=createAppleClient({loadCredential:()=>{loads++;return privateKey;},fetch:async(url,o)=>{seen.push(url);const jwt=o.headers.Authorization.slice(7),[h,p,s]=jwt.split('.'),claims=JSON.parse(Buffer.from(p,'base64url'));assert.equal(JSON.parse(Buffer.from(h,'base64url')).alg,'ES256');assert.equal(claims.aud,'appstoreconnect-v1');assert.equal(claims.exp-claims.iat,600);assert(crypto.verify('sha256',Buffer.from(h+'.'+p),{key:pair.publicKey,dsaEncoding:'ieee-p1363'},Buffer.from(s,'base64url')));assert.equal(o.redirect,'error');return Response.json({data:[{id:seen.length}],links:{next:seen.length===1?'https://api.appstoreconnect.apple.com/v1/apps?cursor=2':null}});}});
 assert.equal((await client.list(profile,'/v1/apps')).length,2);assert.equal(loads,1);
 await client.request({...profile,id:'other'},'GET','/v1/apps');assert.equal(loads,2);
 await assert.rejects(client.request(profile,'GET','https://evil.example/v1/apps'),/地址无效/);assert.equal(seen.length,3);
 client.invalidate();await client.request(profile,'GET','/v1/apps');assert.equal(loads,3);
});
test('Apple creates product, version, locales and initial price then verifies and consumes preview',async()=>{
 const h=harness(),after={...target(),initialPrice:{territory:'USA',currency:'USD',price:'0.99'}};
 const plan=await h.service.preview(profile,[{before:null,after}]);assert(!h.calls.some(c=>c.method==='POST'));
 const b={id:plan.id,platform:'apple',appId:profile.appId},result=await h.service.commit(profile,b);
 assert.equal(result.results[0].status,'verified',JSON.stringify(result));
 assert.deepEqual(h.calls.filter(c=>c.method==='POST').map(c=>c.url),['/v2/inAppPurchases','/v1/inAppPurchaseVersions','/v2/inAppPurchaseLocalizations','/v1/inAppPurchasePriceSchedules']);
 await assert.rejects(h.service.commit(profile,b),/失效/);
 assert.equal((await h.service.reconcile(profile,result.logFile)).results[0].status,'verified');
 await assert.rejects(h.service.reconcile({...profile,id:'other'},result.logFile),/不属于/);
 const actual=(await h.service.list(profile))[0],changed={...P.editable(actual),name:'New name'};
 const next=await h.service.preview(profile,[{before:actual,after:changed}]);
 await assert.rejects(h.service.commit({...profile,id:'other'},{id:next.id,platform:'apple',appId:profile.appId}),/目标/);
 const update=await h.service.commit(profile,{id:next.id,platform:'apple',appId:profile.appId});assert.equal(update.results[0].status,'verified');
 assert.equal(h.calls.filter(c=>c.method==='POST'&&c.url.includes('PriceSchedules')).length,1);
});
test('Apple partial write stays uncertain; reconcile reads only and retry uses existing product/version',async()=>{
 const h=harness(),after=target(),plan=await h.service.preview(profile,[{before:null,after}]);h.failLocale(true);
 const result=await h.service.commit(profile,{id:plan.id,platform:'apple',appId:profile.appId});assert.equal(result.results[0].status,'uncertain');assert.deepEqual(result.results[0].completed,['create','version']);
 const count=h.calls.filter(c=>c.method==='POST').length;const check=await h.service.reconcile(profile,result.logFile);assert.equal(check.results[0].status,'pending');assert.equal(h.calls.filter(c=>c.method==='POST').length,count);
 h.failLocale(false);const next=await h.service.preview(profile,[{before:check.results[0].actual,after}]);const retry=await h.service.commit(profile,{id:next.id,platform:'apple',appId:profile.appId});assert.equal(retry.results[0].status,'verified');assert.equal(h.calls.filter(c=>c.method==='POST'&&c.url==='/v2/inAppPurchases').length,1);
});
test('Apple rejects wrong app identity and remote conflicts before writes',async()=>{
 const h=harness();h.mismatch();await assert.rejects(h.service.preview(profile,[{after:target()}]),/不匹配/);assert(!h.calls.some(c=>c.method==='POST'));
 const g=harness(),plan=await g.service.preview(profile,[{after:target()}]);g.rows.set('coins.100',{id:'external',...target(),localizations:[],version:null});const r=await g.service.commit(profile,{id:plan.id,platform:'apple',appId:profile.appId});assert.equal(r.results[0].status,'failed');assert(!g.calls.some(c=>c.method==='POST'));
});
test('Apple workspace keeps Google configuration intact, hides credentials and invalidates old profile targets',async()=>{
 const h=harness();h.save('config.json',{google:true});const w=createAppleWorkspace({data:'unused',read:h.read,save:h.save,client:h.client});
 const body={name:'Apple A',appId:profile.appId,bundleId:profile.bundleId,keyId:profile.keyId,issuerId:profile.issuerId};
 const a=await w.route('/api/apple/config/save',body),b=await w.route('/api/apple/config/save',{...body,name:'Apple B',appId:'987654'});
 assert.notEqual(a.activeId,b.activeId);assert(!JSON.stringify(a).includes('credentialFile'));assert.deepEqual(h.read('config.json'),{google:true});
 await assert.rejects(w.route('/api/apple/products',{platform:'apple',profileId:a.activeId,appId:profile.appId}),/已切换/);
 await assert.rejects(w.route('/api/apple/config/save',{...body,id:b.activeId}),/不可更改/);
});

test('Apple preview validates new-product currency before creating anything',async()=>{
 const h=harness();const after={...target(),initialPrice:{territory:'USA',currency:'EUR',price:'0.99'}};
 await assert.rejects(h.service.preview(profile,[{after}]),/币种/);
 assert(!h.calls.some(c=>c.method!=='GET'));
});
test('Apple reconciliation preserves partial metadata when price lookup fails and continues later items',async()=>{
 const h=harness(),a={...target(),initialPrice:{territory:'USA',currency:'USD',price:'2.34'}},b={...target(),productId:'coins.other'};
 const plan=await h.service.preview(profile,[{after:a},{after:b}]);
 const result=await h.service.commit(profile,{id:plan.id,platform:'apple',appId:profile.appId});
 assert.equal(result.results[0].status,'uncertain');assert.equal(result.results[1].status,'verified');
 const count=h.calls.filter(c=>c.method!=='GET').length;
 const check=await h.service.reconcile(profile,result.logFile);
 assert.equal(check.results[0].canLoadCurrent,true);assert.equal(check.results[0].actual.productId,a.productId);assert.equal(check.results[0].status,'pending');assert.match(check.results[0].message,/匹配价格/);
 assert.equal(check.results[1].status,'verified');assert.equal(h.calls.filter(c=>c.method!=='GET').length,count);
 const original=h.client.list;h.client.list=async(p,url)=>{if(url.includes('filter%5BproductId%5D=coins.100'))throw Error('read failed');return original(p,url);};
 const failed=await h.service.reconcile(profile,result.logFile);
 assert.equal(failed.results[0].canLoadCurrent,false);assert.equal(Object.hasOwn(failed.results[0],'actual'),false);assert.match(failed.results[0].message,/read failed/);assert.equal(failed.results[1].status,'verified');
});

test('Apple territory validation uses the collection and rejects unknown territories before writes',async()=>{
 const h=harness(),after={...target(),initialPrice:{territory:'USA',currency:'USD',price:'0.99'}};
 const plan=await h.service.preview(profile,[{after}]);assert.equal(plan.entries.length,1);
 assert(h.calls.some(c=>c.url==='/v1/territories?limit=200'));
 assert(!h.calls.some(c=>c.url.startsWith('/v1/territories/')));
 await assert.rejects(h.service.preview(profile,[{after:{...after,initialPrice:{...after.initialPrice,territory:'ZZZ'}}}]),/不支持该基准地区/);
 assert(h.calls.every(c=>c.method==='GET'));
});


test('Apple CSV rejects unknown optional headers instead of dropping review notes or prices',()=>{
 const headers='productId,name,inAppPurchaseType,locale,displayName,description';
 const row='coins.100,Coins 100,CONSUMABLE,en-US,100 Coins,Receive 100 coins';
 assert.throws(()=>P.importCSV(headers+',reviewNotes\n'+row+',Important'),/不支持的列：reviewNotes/);
 assert.throws(()=>P.importCSV(headers+',baseTerritory,currencyCode,initialPrice\n'+row+',USA,USD,0.99'),/baseTerritory、currencyCode、initialPrice/);
 assert.equal(P.importCSV(headers+'\n'+row)[0].productId,'coins.100');
});
test('Apple unchanged price previews return verified items and mixed batches commit only changes',async()=>{
 const h=harness(),after={...target(),initialPrice:{territory:'USA',currency:'USD',price:'0.99'}};
 const first=await h.service.preview(profile,[{after}]);await h.service.commit(profile,{id:first.id,platform:'apple',appId:profile.appId});
 const before=(await h.service.list(profile))[0],writes=h.calls.filter(c=>c.method!=='GET').length;
 const noop=await h.service.preview(profile,[{before,after}]);assert.equal(noop.entries.length,0);assert.equal(noop.id,undefined);assert.equal(noop.unchanged[0].status,'verified');assert.deepEqual(noop.unchanged[0].actual,before);
 const mixed=await h.service.preview(profile,[{before,after},{after:{...target(),productId:'coins.other'}}]);assert.equal(mixed.entries.length,1);assert.equal(mixed.unchanged.length,1);assert.equal(h.calls.filter(c=>c.method!=='GET').length,writes);
 const result=await h.service.commit(profile,{id:mixed.id,platform:'apple',appId:profile.appId});assert.deepEqual(result.results.map(x=>x.productId),['coins.other']);assert.equal(result.results[0].status,'verified');
 const reconciled=await h.service.reconcile(profile,result.logFile);assert.equal(reconciled.results[0].before,null);
});
test('Apple exports current base price, keeps local pending price and never writes remotely',async()=>{
 const h=harness(),after={...target(),initialPrice:{territory:'USA',currency:'USD',price:'0.99'}};
 const plan=await h.service.preview(profile,[{after},{after:{...target(),productId:'unpriced'}}]);await h.service.commit(profile,{id:plan.id,platform:'apple',appId:profile.appId});
 const remote=await h.service.list(profile),before=structuredClone(remote),products=remote.map(P.editable),writes=h.calls.filter(c=>c.method!=='GET').length;
 const result=await h.service.exportWithPrices(profile,products,products.map(p=>p.productId)),parsed=P.importCSV(result.csv);
 assert.deepEqual(parsed.find(p=>p.productId===after.productId).initialPrice,after.initialPrice);assert.match(result.warnings[0],/unpriced.*尚无价格计划/);assert.deepEqual(remote,before);assert(!products[0].initialPrice);
 const pending={...products[0],initialPrice:{territory:'USA',currency:'USD',price:'2.99'}},calls=h.calls.length;
 assert.equal(P.importCSV((await h.service.exportWithPrices(profile,[pending],[pending.productId])).csv)[0].initialPrice.price,'2.99');assert.equal(h.calls.length,calls);
 assert.equal(h.calls.filter(c=>c.method!=='GET').length,writes);
 await assert.rejects(h.service.exportWithPrices(profile,products,['not-selected']),/范围无效/);
 const list=h.client.list;h.client.list=async(p,url)=>url.includes('/pricePoints?')?[]:list(p,url);
 await assert.rejects(h.service.exportWithPrices(profile,[products[0]],[products[0].productId]),/未读取到基准价格金额/);
});

test('Apple price export chooses the current base territory period and rejects ambiguous prices',async()=>{
 const h=harness(),after={...target(),initialPrice:{territory:'USA',currency:'USD',price:'0.99'}};
 const plan=await h.service.preview(profile,[{after}]);await h.service.commit(profile,{id:plan.id,platform:'apple',appId:profile.appId});
 const actual=(await h.service.list(profile))[0],product=P.editable(actual),original=h.client.list;let ambiguous=false;
 h.client.list=async(p,url)=>{const rows=await original(p,url);if(!url.includes('/manualPrices?'))return rows;const current=rows[0];return [
  {...current,id:'future',attributes:{startDate:'2099-01-01',endDate:null},relationships:{...current.relationships,inAppPurchasePricePoint:{data:{id:'future-point'}}}},
  {...current,id:'expired',attributes:{startDate:'1999-01-01',endDate:'2000-01-01'}},
  {...current,id:'other-territory',relationships:{...current.relationships,territory:{data:{id:'CHN'}}}},
  ...rows,...(ambiguous?[{...current,id:'duplicate'}]:[])
 ];};
 const result=await h.service.exportWithPrices(profile,[product],[product.productId]);assert.equal(P.importCSV(result.csv)[0].initialPrice.price,'0.99');
 ambiguous=true;await assert.rejects(h.service.exportWithPrices(profile,[product],[product.productId]),/唯一的当前基准价格/);
});

test('Apple exported current price with a scheduled future change previews as unchanged',async()=>{
 const h=harness(),after={...target(),initialPrice:{territory:'USA',currency:'USD',price:'0.99'}};
 const first=await h.service.preview(profile,[{after}]);await h.service.commit(profile,{id:first.id,platform:'apple',appId:profile.appId});
 const original=h.client.list;h.client.list=async(p,url)=>{const rows=await original(p,url);return url.includes('/manualPrices?')?rows.map(x=>({...x,attributes:{...x.attributes,endDate:'2099-01-01'}})):rows;};
 const before=(await h.service.list(profile))[0],exported=await h.service.exportWithPrices(profile,[P.editable(before)],[before.productId]);
 const imported=P.importCSV(exported.csv)[0],writes=h.calls.filter(c=>c.method!=='GET').length,plan=await h.service.preview(profile,[{before,after:imported}]);
 assert.equal(plan.entries.length,0);assert.equal(plan.unchanged.length,1);assert.equal(h.calls.filter(c=>c.method!=='GET').length,writes);
});
