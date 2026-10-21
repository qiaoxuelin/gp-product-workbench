'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {createDestination}=require('../finance-sync-lark');
const {COLUMNS}=require('../finance-sync');
test('destination writes typed raw values, refreshes native pivot and verifies readback',async()=>{
 let rows=[],pivot=false;const calls=[],sheets=[];
 const run=async(command,args,payload)=>{
  calls.push({command,args,payload});const value=key=>args[args.indexOf(key)+1];
  if(command==='+workbook-info')return {sheets};
  if(command==='+table-get')return {sheets:[{columns:COLUMNS,data:rows.map(row=>row.map(v=>v===''?null:v))}]};
  if(command==='+table-put'){
   const item=payload.sheets[0];if(item.name==='PlayBatch账单明细'){if(!sheets.some(s=>s.sheet_name===item.name))sheets.push({sheet_name:item.name,sheet_id:'raw'});rows=item.data;}
   return {};
  }
  if(command==='+sheet-create'){sheets.push({sheet_name:value('--title'),sheet_id:'summary'});return {};}
  if(command==='+pivot-list')return {sheets:[{pivot_tables:pivot?[{pivot_table_id:'pivot',info:{error_state:'None'}}]:[]}]};
  if(command==='+pivot-create'||command==='+pivot-update'){pivot=true;return {};}
  if(command==='+styles-put')return {};
  throw Error('Unexpected command '+command);
 };
 const d=createDestination({run});assert.deepEqual(await d.read('https://example.feishu.cn/wiki/test'),[]);
 const expected=[['2026-09','Game','HKD',70,'com.game','Charge','file.csv','1','id','bucket','']];
 await d.write('https://example.feishu.cn/wiki/test',expected,0);
 assert.deepEqual(rows,expected);
 const write=calls.find(c=>c.command==='+table-put'&&c.payload.sheets[0].name==='PlayBatch账单明细');assert.equal(write.payload.sheets[0].dtypes['净收入'],'float64');
 const p=calls.find(c=>c.command==='+pivot-create');assert.deepEqual(p.payload.rows.map(r=>r.field),['产品','币种']);assert.equal(p.payload.columns[0].field,'月份');assert.equal(p.payload.show_col_grand_total,false);
 assert(calls.filter(c=>c.command==='+table-get').length>=1);
 await d.read('https://example.feishu.cn/wiki/test');await d.write('https://example.feishu.cn/wiki/test',expected,1);
 assert(calls.some(c=>c.command==='+pivot-update'&&c.payload.source.includes('A1:K2')));
});
