'use strict';
const fs=require('node:fs'),path=require('node:path'),{execFile}=require('node:child_process'),{COLUMNS,validateUrl}=require('./finance-sync');
const RAW='PlayBatch账单明细',SUMMARY='Play月度收入',TITLE='PlayBatch · 每产品每月收入（商户币种）';
const cliPath=()=>path.join(process.env.APPDATA||'','npm','node_modules','@larksuite','cli','bin','lark-cli.exe');
function cliAvailable(){return fs.existsSync(cliPath());}
function runCli(command,args,payload){
 if(!cliAvailable())return Promise.reject(Error('本机未安装 lark-cli；请安装并以当前 Windows 用户登录飞书后再同步'));
 const flag=command==='+table-put'?'--sheets':command==='+styles-put'?'--styles':'--properties';
 return new Promise((resolve,reject)=>{
  const child=execFile(cliPath(),['sheets',command,...args,'--as','user',...(payload?[flag,'-']:[])],{windowsHide:true,timeout:120000,maxBuffer:32*1024*1024,encoding:'utf8',env:{...process.env,LARKSUITE_CLI_NO_UPDATE_NOTIFIER:'1',LARKSUITE_CLI_NO_SKILLS_NOTIFIER:'1'}},(error,stdout,stderr)=>{
   let result;try{result=JSON.parse(stdout);}catch{try{result=JSON.parse(stderr);}catch{}}
   if(error||!result?.ok)return reject(Error(result?.error?.message||'飞书同步命令未完成，请检查 lark-cli 登录、文档权限及网络'));
   resolve(result.data);
  });
  child.stdin.on('error',()=>{});child.stdin.end(payload?JSON.stringify(payload):'');
 });
}
function createDestination({run=runCli}={}){
 const snapshots=new Map();
 const call=(url,cmd,args=[],payload)=>run(cmd,['--url',validateUrl(url),...args],payload);
 const info=url=>call(url,'+workbook-info');
 const pivots=data=>(data.sheets||[]).flatMap(s=>s.pivot_tables||[]);
 function unpack(data){
  if(data.truncated||data.has_more)throw Error('飞书读取结果不完整，未覆盖数据');
  const sheet=data.sheets?.[0];if(!sheet||sheet.truncated||sheet.has_more)throw Error('飞书读取结果不完整，未覆盖数据');
  return sheet;
 }
 async function read(url){
  const workbook=await info(url),sheet=workbook.sheets.find(s=>s.sheet_name===RAW);let rows=[];
  if(sheet){const table=unpack(await call(url,'+table-get',['--sheet-id',sheet.sheet_id,'--max-chars','20000000']));
   if(JSON.stringify(table.columns)!==JSON.stringify(COLUMNS))throw Error(RAW+' 表头与同步格式不符，未修改原表');
   rows=(table.data||[]).filter(r=>r.some(v=>v!==null&&v!=='')).map(r=>COLUMNS.map((c,i)=>c==='净收入'?r[i]:(r[i]??'')));
   if(rows.length>49999||rows.some(r=>r.length!==COLUMNS.length||typeof r[3]!=='number'||!r[8]))throw Error('同步明细结构或金额类型异常，未覆盖原表');
  }
  snapshots.set(url,JSON.stringify(rows));return rows;
 }
 async function ensurePivot(url,count){
  const workbook=await info(url);let sheet=workbook.sheets.find(s=>s.sheet_name===SUMMARY),created=false;
  if(!sheet){await call(url,'+sheet-create',['--title',SUMMARY]);created=true;}
  const list=pivots(await call(url,'+pivot-list',['--sheet-name',SUMMARY]));
  if(list.length>1)throw Error('月度收入页包含多个透视表，请人工核对');
  if(!list.length){
   if(!created){const table=unpack(await call(url,'+table-get',['--sheet-name',SUMMARY,'--no-header']));const values=(table.data||[]).flat().filter(v=>v!==null&&v!=='');if(values.length&&values[0]!==TITLE)throw Error('已有同名月度收入页，未覆盖其内容');}
   await call(url,'+table-put',[],{sheets:[{name:SUMMARY,columns:[TITLE],data:[['净额含收入、费用、退款及调整；账户税项单列，各币种分别查看。空白不代表零收入。']],allow_overwrite:true}]});
  }
  const source="'"+RAW+"'!A1:K"+(count+1),properties={rows:[{field:'产品'},{field:'币种'}],columns:[{field:'月份'}],values:[{field:'净收入',display_name:'净收入',summarize_by:'sum'}],show_row_grand_total:false,show_col_grand_total:false,show_subtotals:false,repeat_row_labels:true};
  if(list.length)await call(url,'+pivot-update',['--sheet-name',SUMMARY,'--pivot-table-id',list[0].pivot_table_id],{...properties,source});
  else await call(url,'+pivot-create',['--source',source,'--target-sheet-name',SUMMARY,'--target-position','A4'],properties);
  for(let attempt=0;attempt<5;attempt++){
   const check=pivots(await call(url,'+pivot-list',['--sheet-name',SUMMARY]));
   if(check.length===1&&check[0].info?.error_state==='None')return;
   if(attempt<4)await new Promise(resolve=>setTimeout(resolve,1000));
  }
  throw Error('月度收入透视表未通过回读检查，请重试同步');
 }
 async function write(url,rows,oldCount){
  const baseline=snapshots.get(url);if(baseline===undefined)throw Error('写入前必须先读取目标表');
  const latest=await read(url);if(JSON.stringify(latest)!==baseline)throw Error('同步期间飞书明细已被其他操作修改，请重新同步');
  if(rows.length>49999)throw Error('同步明细超过 49999 行');
  const dtypes=Object.fromEntries(COLUMNS.map(c=>[c,c==='净收入'?'float64':'object']));
  const padded=rows.concat(Array.from({length:Math.max(0,oldCount-rows.length)},()=>COLUMNS.map(()=>null)));
  const size=500;
  for(let offset=0;offset<Math.max(1,padded.length);offset+=size){
   await call(url,'+table-put',[],{sheets:[{name:RAW,start_cell:offset?'A'+(offset+2):'A1',header:offset===0,columns:COLUMNS,dtypes,formats:{净收入:'#,##0.00'},data:padded.slice(offset,offset+size),allow_overwrite:true}]});
  }
  const actual=await read(url);if(JSON.stringify(actual)!==JSON.stringify(rows))throw Error('飞书账单回读与写入内容不一致，未标记同步成功');
  if(rows.length)await ensurePivot(url,rows.length);
  const width=(column,index)=>Math.min(400,Math.max(100,...[column,...rows.slice(0,1000).map(r=>r[index])].map(v=>Array.from(String(v??'')).reduce((n,c)=>n+(c.charCodeAt(0)>255?16:8),24))));
  const columnName=n=>{let name='';for(;n;n=Math.floor((n-1)/26))name=String.fromCharCode(65+(n-1)%26)+name;return name;};
  const lastColumn=columnName(new Set(rows.map(r=>r[0])).size+2),lastRow=new Set(rows.map(r=>JSON.stringify([r[1],r[2]]))).size+5;
  await call(url,'+styles-put',[],{styles:[{name:RAW,cell_styles:[{range:'A1:K1',font_weight:'bold',background_color:'#E8EDF5',vertical_alignment:'middle'}],col_sizes:COLUMNS.map((c,i)=>({range:String.fromCharCode(65+i),type:'pixel',size:width(c,i)})),freeze:{rows:1}},{name:SUMMARY,cell_styles:[{range:'A1',font_weight:'bold',font_size:16},{range:'C5:'+lastColumn+lastRow,number_format:'#,##0.00'}],col_sizes:[{range:'A',type:'pixel',size:320},{range:'B',type:'pixel',size:100}],freeze:{rows:4,cols:2}}]});
 }
 return {read,write,verify:ensurePivot,inspect:info};
}
module.exports={createDestination,runCli,cliAvailable,RAW,SUMMARY};
