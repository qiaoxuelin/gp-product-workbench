'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {createReporting,query,SCOPE}=require('../play-reporting');
const now=Date.parse('2026-10-28T10:25:00Z'),profile={id:'one',packageName:'com.example.game',credentialFile:'one'};
const input={startTime:'2026-10-27T10:00Z',endTime:'2026-10-28T10:00Z',type:'ANR',versionCode:'9007199254740993',apiLevel:'35',errorIssueId:'123'};
test('report search uses the reporting host, scope, UTC structured interval and exact filters',async()=>{
 let url,options;const n=createReporting({now:()=>now,accessToken:async(scope,p)=>{assert.equal(scope,SCOPE);assert.deepEqual(p,profile);return 'test-token';},fetchImpl:async(u,o)=>{url=new URL(u);options=o;return Response.json({errorReports:[{name:'r',reportText:'stack\nline'}],nextPageToken:'next'});}});
 const result=await n.search(profile,input);assert.equal(url.origin,'https://playdeveloperreporting.googleapis.com');assert.equal(url.pathname,'/v1beta1/apps/com.example.game/errorReports:search');
 assert.equal(url.searchParams.get('filter'),'errorIssueType = ANR AND versionCode = 9007199254740993 AND apiLevel = 35 AND errorIssueId = 123');assert.equal(url.searchParams.get('interval.startTime.year'),'2026');assert.equal(url.searchParams.get('interval.startTime.day'),'27');assert.equal(url.searchParams.get('interval.startTime.hours'),'10');assert.equal(url.searchParams.get('interval.endTime.timeZone.id'),'UTC');assert.equal(options.headers.Authorization,'Bearer test-token');assert.equal(options.redirect,'error');assert.equal(options.body,undefined);assert.equal(result.reports[0].reportText,'stack\nline');assert.equal(result.nextPageToken,'next');
 await n.search(profile,{...input,pageToken:'next'});assert.equal(url.searchParams.get('pageToken'),'next');
});
test('invalid filters, dates and oversized queries never reach Google',async()=>{
 let calls=0;const n=createReporting({now:()=>now,accessToken:async()=>{calls++;}});
 for(const patch of [{type:'NON_FATAL'},{versionCode:'1 OR errorIssueType = ANR'},{apiLevel:35},{startTime:'2026-02-30T00:00Z'},{endTime:'2026-10-28T11:00Z'},{startTime:'2026-10-28T10:01Z'},{startTime:'2026-10-28T10:00Z'},{startTime:'2025-01-01T00:00Z'},{pageSize:101},{pageToken:4}])await assert.rejects(n.search(profile,{...input,...patch}));
 assert.equal(calls,0);await assert.rejects(n.search({...profile,packageName:'../../secret'},input));
});
test('default query is previous 24 full UTC hours and excludes nonfatal reports',()=>{const q=query({},now);assert.deepEqual(q.interval,{startTime:'2026-10-27T10:00:00.000Z',endTime:'2026-10-28T10:00:00.000Z'});assert.equal(q.params.get('filter'),'errorIssueType = CRASH OR errorIssueType = ANR');});
test('identical concurrent requests coalesce without mixing application identities',async()=>{
 let calls=0,finish;const n=createReporting({now:()=>now,accessToken:async()=>'',fetchImpl:async()=>{calls++;await new Promise(r=>finish=r);return Response.json({});}});
 const a=n.search(profile,input),b=n.search(profile,input);await new Promise(r=>setImmediate(r));assert.equal(calls,1);finish();assert.deepEqual(await a,await b);
 const c=n.search({...profile,id:'two',packageName:'com.other.game'},input);await new Promise(r=>setImmediate(r));assert.equal(calls,2);finish();assert.equal((await c).packageName,'com.other.game');
});
test('quota response stops further requests until cooldown and does not report a permission error',async()=>{
 let clock=now,calls=0;const n=createReporting({now:()=>clock,accessToken:async()=>'',fetchImpl:async()=>{calls++;return calls===1?Response.json({error:{message:'quota exceeded'}},{status:403,headers:{'Retry-After':'120'}}):Response.json({});}});
 await assert.rejects(n.search(profile,input),/暂停当前应用查询 120 秒/);await assert.rejects(n.search(profile,input),/配额受限/);assert.equal(calls,1);clock+=120000;assert.deepEqual((await n.search(profile,input)).reports,[]);assert.equal(calls,2);
});
test('disabled API and missing permissions give distinct actionable errors',async()=>{
 for(const [body,status,pattern]of [[{error:{details:[{reason:'SERVICE_DISABLED'}]}},403,/启用 Google Play Developer Reporting API/],[{error:{}},403,/查看应用信息/],[{error:{}},401,/授权失效/],[{error:{}},404,/未找到/]]){const n=createReporting({now:()=>now,accessToken:async()=>'',fetchImpl:async()=>Response.json(body,{status})});await assert.rejects(n.search(profile,input),pattern);}
});
test('invalid provider payload is not treated as a successful empty result',async()=>{const n=createReporting({now:()=>now,accessToken:async()=>'',fetchImpl:async()=>Response.json({errorReports:{}})});await assert.rejects(n.search(profile,input),/列表无效/);});
test('malformed report objects and invalid end times return actionable failures',async()=>{assert.throws(()=>query({endTime:'invalid'},now),/结束时间/);for(const body of [null,{errorReports:[null]},{errorReports:[{name:'r',reportText:{}}]}]){const n=createReporting({now:()=>now,accessToken:async()=>'',fetchImpl:async()=>Response.json(body)});await assert.rejects(n.search(profile,input),/返回.*无效/);}});
