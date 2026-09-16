'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const F=require('../finance');
test('report configuration normalizes Cloud Storage URI and limits earnings to selected month',()=>{
  assert.equal(F.normalizeBucket(' gs://pubsite_prod_rev_test/earnings/ '),'pubsite_prod_rev_test');
  assert.throws(()=>F.normalizeBucket('https://evil.example/report'));
  assert.throws(()=>F.monthPrefix('2026-13'));
  assert(F.reportName('earnings/earnings_202608_adjustment.zip',F.monthPrefix('2026-08')));
  assert(!F.reportName('earnings/earnings_2026089.zip',F.monthPrefix('2026-08')));
  assert(!F.reportName('sales/salesreport_202608.zip',F.monthPrefix('2026-08')));
});
test('financial reports paginate, preserve original bytes, pin generation and isolate project tickets',async t=>{
  const old=global.fetch;t.after(()=>global.fetch=old);
  const bytes=Buffer.from('original report bytes'),md5Hash=crypto.createHash('md5').update(bytes).digest('base64');
  const config={id:'project-a',financialBucket:'pubsite_prod_rev_test',credentialFile:'credential-a.dpapi'};
  const scopes=[],requests=[];let corrupt=false;
  global.fetch=async(url,options)=>{
    const u=new URL(url);requests.push(u);
    assert.equal(u.hostname,'storage.googleapis.com');assert.equal(options.headers.Authorization,'Bearer read-only');
    if(u.searchParams.get('alt')==='media'){assert.equal(u.searchParams.get('generation'),'321');return new Response(corrupt?Buffer.from('x'):bytes);}
    assert.equal(u.searchParams.get('prefix'),'earnings/earnings_202608');
    const item={name:'earnings/earnings_202608.zip',size:String(bytes.length),generation:'321',md5Hash,updated:'2026-09-05T00:00:00Z'};
    return Response.json(u.searchParams.get('pageToken')?{items:[{...item,name:'earnings/earnings_202608_adjustment.zip'}]}:{items:[item,{...item,name:'earnings/earnings_202607.zip'}],nextPageToken:'next'});
  };
  const finance=F.createFinance(async scope=>{scopes.push(scope);return 'read-only';});
  const list=await finance.list(config,'2026-08');assert.equal(list.files.length,2);assert.equal(list.scope,'developer-account');
  const file=await finance.download(config,list.files[0].id);assert.deepEqual(file.bytes,bytes);
  assert.equal(file.sha256,crypto.createHash('sha256').update(bytes).digest('hex'));
  assert(scopes.every(x=>x===F.SCOPE));assert.equal(requests.filter(u=>u.searchParams.has('pageToken')).length,1);
  await assert.rejects(finance.download({...config,id:'project-b'},list.files[0].id),/项目已切换/);
  await assert.rejects(finance.download({...config,financialBucket:'pubsite_prod_rev_other'},list.files[0].id),/项目已切换/);
  await assert.rejects(finance.download({...config,credentialFile:'replacement'},list.files[0].id),/项目已切换/);
  corrupt=true;await assert.rejects(finance.download(config,list.files[0].id),/不完整/);
});
test('financial exports reject checksum mismatch and explain financial permission failures',async t=>{
  const old=global.fetch;t.after(()=>global.fetch=old);
  const config={id:'a',financialBucket:'pubsite_prod_rev_test'},finance=F.createFinance(async()=> 'token');
  global.fetch=async url=>String(url).includes('alt=media')?new Response(Buffer.from('abc')):Response.json({items:[{name:'earnings/earnings_202608.zip',size:'3',generation:'1',md5Hash:'wrong'}]});
  const list=await finance.list(config,'2026-08');await assert.rejects(finance.download(config,list.files[0].id),/校验失败/);
  global.fetch=async()=>Response.json({error:{message:'permission denied'}},{status:403});
  await assert.rejects(finance.list(config,'2026-08'),/全局权限/);
});
