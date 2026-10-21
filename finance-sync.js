'use strict';
const crypto=require('node:crypto'),zlib=require('node:zlib'),{parseCSV}=require('./core');
const COLUMNS=['月份','产品','币种','净收入','包名','交易类型','来源文件','报告版本','明细标识','报告桶','交易日期'];
const TYPES=new Set(['Charge','Charge refund','Google fee','Google fee refund','Charge rebill','Google fee rebill','Tax','Tax rebill','Adjustment']);
const digest=value=>crypto.createHash('sha256').update(value).digest('hex');
const beijing=now=>new Date(now+8*60*60*1000);
function previousMonth(now){const d=beijing(now);return new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth()-1,1)).toISOString().slice(0,7);}
function nextRun(now,day){const d=beijing(now),month=d.getUTCMonth()+(d.getUTCDate()>=day?1:0);return Date.UTC(d.getUTCFullYear(),month,day,1);}
function monthsBetween(first,last){if(!/^20\d{2}-(0[1-9]|1[0-2])$/.test(first))throw Error('起始月份无效');const out=[];for(let m=first;m<=last;){out.push(m);if(out.length>60)throw Error('单次最多同步 60 个月，请调整起始月份');const [y,n]=m.split('-').map(Number);m=new Date(Date.UTC(y,n,1)).toISOString().slice(0,7);}return out;}
function reportParts(bytes){
 if(!Buffer.isBuffer(bytes)||bytes.length>100*1024*1024)throw Error('账单超过 100MB');
 if(bytes.length<4||bytes.readUInt32LE(0)!==0x04034b50)return [bytes];
 let end=-1;for(let i=bytes.length-22;i>=Math.max(0,bytes.length-65557);i--)if(bytes.readUInt32LE(i)===0x06054b50&&i+22+bytes.readUInt16LE(i+20)===bytes.length){end=i;break;}
 if(end<0)throw Error('账单 ZIP 目录损坏');
 const count=bytes.readUInt16LE(end+10),offset=bytes.readUInt32LE(end+16);let at=offset,total=0;const out=[];
 if(bytes.readUInt16LE(end+4)||bytes.readUInt16LE(end+6)||!count||count>100||offset>=end)throw Error('账单 ZIP 结构不受支持');
 for(let i=0;i<count;i++){
  if(at+46>end||bytes.readUInt32LE(at)!==0x02014b50)throw Error('账单 ZIP 目录损坏');
  const flags=bytes.readUInt16LE(at+8),method=bytes.readUInt16LE(at+10),size=bytes.readUInt32LE(at+20),expanded=bytes.readUInt32LE(at+24),nl=bytes.readUInt16LE(at+28),extra=bytes.readUInt16LE(at+30),comment=bytes.readUInt16LE(at+32),local=bytes.readUInt32LE(at+42);
  if(at+46+nl+extra+comment>end)throw Error('账单 ZIP 目录损坏');
  const name=bytes.subarray(at+46,at+46+nl).toString('utf8');at+=46+nl+extra+comment;
  if(!/\.csv$/i.test(name))continue;
  if(flags&1||![0,8].includes(method)||expanded>64*1024*1024||total+expanded>128*1024*1024)throw Error('账单加密或解压后过大');
  if(local+30>offset||bytes.readUInt32LE(local)!==0x04034b50||bytes.readUInt16LE(local+8)!==method)throw Error('账单 ZIP 结构损坏');
  const start=local+30+bytes.readUInt16LE(local+26)+bytes.readUInt16LE(local+28);if(start+size>offset)throw Error('账单 ZIP 长度无效');
  const input=bytes.subarray(start,start+size),content=method===8?zlib.inflateRawSync(input,{maxOutputLength:64*1024*1024}):input;
  if(content.length!==expanded)throw Error('账单 ZIP 解压长度不符');total+=content.length;out.push(content);
 }
 if(at!==end||!out.length)throw Error('账单 ZIP 中没有可用 CSV');return out;
}
function decode(bytes){
 let encoding='utf-8';if(bytes[0]===0xff&&bytes[1]===0xfe||bytes[1]===0&&bytes[3]===0)encoding='utf-16le';else if(bytes[0]===0xfe&&bytes[1]===0xff)encoding='utf-16be';
 return new TextDecoder(encoding,{fatal:true}).decode(bytes).replace(/^\uFEFF/,'').replace(/\r\n/g,'\n').trim();
}
function parseReport(bytes,{month,bucket,name,generation,names={}}){
 const out=[];for(const part of reportParts(bytes)){
  const text=decode(part),sourceHash=digest(bucket+'\0'+month+'\0'+text),rows=parseCSV(text);
  const headers=new Set(text.split('\n')[0].split(',').map(h=>h.replace(/^"|"$/g,'').trim()));
  for(const field of ['Transaction Type','Package ID','Merchant Currency','Amount (Merchant Currency)'])if(!headers.has(field))throw Error('账单缺少字段：'+field);
  rows.forEach((r,index)=>{
   for(const field of ['Transaction Type','Package ID','Merchant Currency','Amount (Merchant Currency)'])if(!(field in r))throw Error('账单缺少字段：'+field);
   const type=r['Transaction Type'].trim(),pkg=r['Package ID'].trim(),currency=r['Merchant Currency'].trim(),value=r['Amount (Merchant Currency)'].trim();
   if(!TYPES.has(type))throw Error('未知账单交易类型：'+type);
   if(!/^[A-Z]{3}$/.test(currency))throw Error('账单商户币种无效');
   if(!/^-?\d+(\.\d{1,6})?$/.test(value)||Math.abs(Number(value))>1e12)throw Error('账单金额无效');
   const product=type.startsWith('Tax')?'账户税费（未分摊）':pkg?(names[pkg]||pkg):'账户调整（未分摊）';
   out.push([month,product,currency,Number(value),pkg,type,name,String(generation||''),sourceHash+':'+index,bucket,r['Transaction Date']||'']);
  });
 }return out;
}
function validateUrl(value){let u;try{u=new URL(value);}catch{throw Error('请填写飞书电子表格链接');}if(u.protocol!=='https:'||u.username||u.password||!/(^|\.)(feishu\.cn|larksuite\.com)$/.test(u.hostname)||!/^\/(wiki|sheets|spreadsheets)\/[A-Za-z0-9]+\/?$/.test(u.pathname))throw Error('请填写有效飞书电子表格或 Wiki 链接');u.hash='';return u.href;}
function createFinanceSync({read,save,profiles,sourceFor,destination,now=()=>Date.now()}){
 let state=read('finance-sync.json',{})||{},active=false;
 if(state.phase==='running')state={...state,phase:'failed',error:'上次同步中断，将读取线上数据后重试',nextAttempt:now()};
 const write=()=>save('finance-sync.json',state);
 const status=()=>structuredClone({...state,running:active,config:state.config||{enabled:false,profileId:'',url:'',startMonth:previousMonth(now()),day:15,productNames:{}}});
 function configure(input){
  if(active)throw Error('正在同步账单，请完成后修改配置');
  if(typeof input.enabled!=='boolean'||!Number.isInteger(input.day)||input.day<1||input.day>28)throw Error('请选择自动同步开关和每月 1–28 日');
  monthsBetween(input.startMonth,previousMonth(now()));const profile=profiles().find(p=>p.id===input.profileId);
  if(!profile)throw Error('请选择授权项目');
  if(input.enabled&&(!profile.financialBucket||!(profile.credentialFile||profile.credentialPath)))throw Error('启用前请保存财务报告桶地址并配置服务账号');
  const names=input.productNames||{};if(typeof names!=='object'||Array.isArray(names)||Object.entries(names).some(([k,v])=>!k||k.length>200||typeof v!=='string'||!v.trim()||v.length>200))throw Error('产品名称映射无效');
  state={...state,config:{enabled:input.enabled,profileId:profile.id,url:validateUrl(input.url),startMonth:input.startMonth,day:input.day,productNames:names},nextAttempt:0};write();return status();
 }
 function due(){if(active||!state.config?.enabled||now()<(state.nextAttempt||0))return false;if(state.nextAttempt)return true;const d=beijing(now());return d.getUTCDate()>=state.config.day;}
 async function run(){
  if(active)throw Error('账单同步已在运行');if(!state.config)throw Error('请先保存月度同步设置');
  const c=structuredClone(state.config),profile=structuredClone(profiles().find(p=>p.id===c.profileId)||{});
  if(!profile.financialBucket||!(profile.credentialFile||profile.credentialPath))throw Error('请先保存财务报告桶地址并配置服务账号');
  active=true;state={...state,phase:'running',error:'',lastAttempt:new Date(now()).toISOString()};write();
  try{
   const source=sourceFor(profile),oldRows=await destination.read(c.url);let rows=oldRows.map(r=>r.slice());const missing=[],names={...Object.fromEntries(profiles().map(p=>[p.packageName,p.name])),...c.productNames};let files=0;
   for(const month of monthsBetween(c.startMonth,previousMonth(now()))){
    state.progress='正在读取 '+month;write();const list=await source.list(profile,month);
    if(!list.files.length){missing.push(month);continue;}
    const monthly=new Map();
    for(const item of list.files){const file=await source.download(profile,item.id);for(const row of parseReport(file.bytes,{month,bucket:profile.financialBucket,name:item.name,generation:item.generation,names}))if(!monthly.has(row[8]))monthly.set(row[8],row);files++;}
    if(!monthly.size){missing.push(month);continue;}
    rows=rows.filter(r=>!(r[0]===month&&r[9]===profile.financialBucket)).concat([...monthly.values()]);
    if(rows.length>49999)throw Error('账单明细超过 49999 行，请缩短同步范围或使用新的目标表');
   }
   rows.sort((a,b)=>String(a[0]).localeCompare(String(b[0]))||String(a[8]).localeCompare(String(b[8])));
   if(JSON.stringify(rows)!==JSON.stringify(oldRows)){state.progress='正在更新飞书月度收入并回读核验';write();await destination.write(c.url,rows,oldRows.length);}
   else if(rows.length&&destination.verify)await destination.verify(c.url,rows.length);
   state={...state,phase:missing.length?'waiting':'complete',progress:'',error:'',lastSuccess:new Date(now()).toISOString(),missingMonths:missing,rowCount:rows.length,fileCount:files,nextAttempt:missing.length?now()+86400000:nextRun(now(),c.day)};
  }catch(e){state={...state,phase:'failed',progress:'',error:e.message,nextAttempt:now()+86400000};}
  finally{active=false;write();}
  return status();
 }
 return {status,configure,due,run,isActive:()=>active};
}
module.exports={COLUMNS,parseReport,createFinanceSync,previousMonth,validateUrl};
