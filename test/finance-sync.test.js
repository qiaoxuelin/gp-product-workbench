'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {parseReport,createFinanceSync,previousMonth}=require('../finance-sync');
const header='Transaction Date,Transaction Type,Package ID,Merchant Currency,Amount (Merchant Currency),Product Title';
const csv=header+'\n"Sep 30, 2026",Charge,com.game,HKD,100.00,Coins\n"Sep 30, 2026",Google fee,com.game,HKD,-30.00,Coins\n"Sep 30, 2026",Charge refund,com.game,HKD,-10.00,Coins\n"Sep 30, 2026",Tax,,HKD,-2.00,\n"Sep 30, 2026",Charge,com.game,USD,1.00,Coins';
const meta={month:'2026-09',bucket:'pubsite_prod_rev_test',name:'earnings_202609.csv',generation:'1',names:{'com.game':'Game'}};
test('earnings preserve merchant amounts, report month, currencies and unallocated taxes',()=>{
 const rows=parseReport(Buffer.from('\uFEFF'+csv,'utf16le'),meta);
 assert.equal(rows.length,5);assert.equal(rows[0][1],'Game');assert.equal(rows[1][3],-30);assert.equal(rows[2][3],-10);
 assert.equal(rows[3][1],'账户税费（未分摊）');assert.equal(rows[4][2],'USD');assert.equal(rows[0][0],'2026-09');
 assert.throws(()=>parseReport(Buffer.from(csv.replace('100.00','invalid')),meta),/金额/);
 assert.throws(()=>parseReport(Buffer.from(csv.replace('Merchant Currency,','Other Currency,')),meta),/字段/);
 assert.throws(()=>parseReport(Buffer.from(csv.replace(',Charge,',',Unknown,')),meta),/交易类型/);
});
function fixture(){
 let saved={},rows=[],writes=0,fail=false,reports=true,time=Date.UTC(2026,9,20);
 const profiles=[{id:'p',name:'Game',packageName:'com.game',financialBucket:meta.bucket,credentialFile:'fixture'}];
 const source={list:async()=>({files:reports?[{id:'a',name:meta.name,generation:'1'},{id:'b',name:'duplicate.csv',generation:'2'}]:[]}),download:async()=>({bytes:Buffer.from(csv)})};
 const destination={read:async()=>structuredClone(rows),write:async(url,next)=>{if(fail)throw Error('write failed');rows=structuredClone(next);writes++;}};
 const worker=createFinanceSync({read:()=>saved,save:(name,value)=>{saved=structuredClone(value);},profiles:()=>profiles,sourceFor:()=>source,destination,now:()=>time});
 worker.configure({enabled:true,profileId:'p',url:'https://pilotgamehub.feishu.cn/wiki/example',startMonth:'2026-09',day:15,productNames:{'com.game':'Game'}});
 return {worker,get rows(){return rows;},get writes(){return writes;},set fail(v){fail=v;},set reports(v){reports=v;},advance:()=>time+=86400000};
}
test('monthly sync deduplicates identical reports and repeat runs; disabled config never schedules',async()=>{
 const f=fixture();assert.equal(f.worker.due(),true);await f.worker.run();assert.equal(f.worker.status().phase,'complete');assert.equal(f.rows.length,5);assert.equal(f.writes,1);assert.equal(f.worker.due(),false);
 await f.worker.run();assert.equal(f.rows.length,5);assert.equal(f.writes,1);
 f.worker.configure({...f.worker.status().config,enabled:false});assert.equal(f.worker.due(),false);
});
test('missing reports and failed writes remain retryable and never become zero-income rows',async()=>{
 const f=fixture();f.reports=false;await f.worker.run();assert.equal(f.worker.status().phase,'waiting');assert.equal(f.rows.length,0);assert.equal(f.writes,0);assert.equal(f.worker.due(),false);f.advance();assert.equal(f.worker.due(),true);
 f.reports=true;f.fail=true;await f.worker.run();assert.equal(f.worker.status().phase,'failed');assert.equal(f.rows.length,0);
 f.fail=false;await f.worker.run();assert.equal(f.worker.status().phase,'complete');assert.equal(f.rows.length,5);
});
test('previous month crosses year boundary and schedule uses Beijing time',()=>{assert.equal(previousMonth(Date.UTC(2026,0,1)),'2025-12');});

test('ZIP reports support UTF-16 and identical CSVs preserve stable identities',()=>{
 const X=require('../vendor/xlsx.full.min.js'),cfb=X.CFB.utils.cfb_new();X.CFB.utils.cfb_add(cfb,'report.csv',Buffer.from('\uFEFF'+csv,'utf16le'));
 const bytes=Buffer.from(X.CFB.write(cfb,{type:'buffer',fileType:'zip',compression:true}));
 assert.deepEqual(parseReport(bytes,meta),parseReport(Buffer.from(csv),meta));
 assert.throws(()=>parseReport(Buffer.from('unrelated header'),meta),/字段/);
});

test('a missed scheduled run catches up before the following month scheduled day',async()=>{
 const f=fixture();await f.worker.run();for(let i=0;i<43;i++)f.advance();assert.equal(f.worker.due(),true);
});
