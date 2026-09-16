'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const W=require('../listings-workbook'),X=require('../vendor/xlsx.full.min.js');
const products=[{productId:'coins_100',listings:[{languageCode:'zh-CN',title:'金币😀',description:'第一行\n第二行'},{languageCode:'en-US',title:'=literal text',description:'100 coins'}],purchaseOptions:[{purchaseOptionId:'buy',price:'keep'}]},{productId:'coins_550',listings:[{languageCode:'en-US',title:'550 coins',description:'More coins'}],purchaseOptions:[]}];
const encode=wb=>Buffer.from(X.write(wb,{type:'buffer',bookType:'xlsx',compression:true}));
const load=()=>X.read(W.exportWorkbook(products,['ja-JP','zh-TW']),{type:'buffer'});
test('Excel language tabs preserve Unicode, literal formula-looking text and product IDs',()=>{
  const bytes=W.exportWorkbook(products,['ja-JP','zh-TW']),wb=X.read(bytes,{type:'buffer'});
  assert.deepEqual(wb.SheetNames,['zh-CN','en-US','ja-JP','zh-TW']);
  assert.equal(wb.Sheets['en-US'].B2.t,'s');assert.equal(wb.Sheets['en-US'].B2.f,undefined);
  const read=W.readWorkbook(bytes);assert.equal(read.rows[0].title,'金币😀');assert.equal(read.rows[0].description,'第一行\n第二行');
  assert.equal(read.sheets.find(s=>s.name==='ja-JP').skipped,2);
});
test('filled sheets merge only listings; empty sheets and unlisted prices remain intact',()=>{
  const wb=load();wb.Sheets['ja-JP'].B2={t:'s',v:'100コイン'};wb.Sheets['ja-JP'].C2={t:'s',v:'100コインを獲得'};
  const result=W.importWorkbook(encode(wb),products);
  assert.equal(result.products[0].listings.find(l=>l.languageCode==='ja-JP').title,'100コイン');
  assert.deepEqual(result.products[0].purchaseOptions,products[0].purchaseOptions);
  assert.equal(products[0].listings.length,2);assert.equal(result.products[0].listings.some(l=>l.languageCode==='zh-TW'),false);
});
test('workbook validation identifies sheet and row, rejects formulas and unknown product scope',()=>{
  let wb=load();wb.Sheets['ja-JP'].B2={t:'s',v:'Only title'};
  assert.throws(()=>W.importWorkbook(encode(wb),products),/页签 ja-JP 第 2 行.*描述/);
  wb=load();wb.Sheets['en-US'].B2={t:'s',f:'HYPERLINK("https://example.com","click")',v:'cached'};
  assert.throws(()=>W.readWorkbook(encode(wb)),/页签 en-US 第 2 行.*公式/);
  wb=load();assert.throws(()=>W.importWorkbook(encode(wb),[products[1]]),/页签 zh-CN 第 2 行.*范围/);
  wb.SheetNames[0]='中文';wb.Sheets['中文']=wb.Sheets['zh-CN'];assert.throws(()=>W.readWorkbook(encode(wb)),/页签名称/);
});
test('malformed archives, oversize ranges and conflicting repeated translations are rejected',()=>{
  assert.throws(()=>W.readWorkbook(Buffer.from('not a workbook')),/无效/);
  assert.throws(()=>W.readWorkbook(Buffer.alloc(5*1024*1024+1)),/5MB/);
  let wb=load();wb.Sheets['en-US']['!ref']='A1:C60000';assert.throws(()=>W.readWorkbook(encode(wb)),/超过/);
  wb=load();X.utils.sheet_add_aoa(wb.Sheets['en-US'],[['coins_100','Different','Conflicting']],{origin:'A4'});
  assert.throws(()=>W.importWorkbook(encode(wb),products),/页签 en-US 第 4 行.*冲突/);
});
