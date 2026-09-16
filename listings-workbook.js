'use strict';
const X=require('./vendor/xlsx.full.min.js'),C=require('./core'),zlib=require('node:zlib');
const MIME='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',LIMIT=50000;
const headers=['productId','title','description'];
function language(value){try{const code=Intl.getCanonicalLocales(value.trim())[0];if(!code||code.length>31)throw Error();return code;}catch{throw Error('页签名称必须为语言代码，例如 zh-CN、en-US、ja-JP：'+value);}}
function csv(rows){return '\uFEFF'+[['productId','languageCode','title','description'],...rows.map(r=>[r.productId,r.languageCode,r.title,r.description])].map(row=>row.map(v=>'"'+String(v??'').replace(/"/g,'""')+'"').join(',')).join('\r\n');}
function exportWorkbook(products,languages=[]){
  const rows=C.parseCSV(C.exportListingsCSV(products,languages)),groups=new Map();
  for(const r of rows){const lang=language(r.languageCode);if(!groups.has(lang))groups.set(lang,new Map());groups.get(lang).set(r.productId,r);}
  if(!groups.size)throw Error('请至少保留或选择一种语言');
  if(groups.size>100||groups.size*products.length>LIMIT)throw Error('模板过大，请减少商品或语言数量后分批操作');
  const wb=X.utils.book_new();wb.Props={Title:'PlayBatch 多语言模板',Author:'qiaoxuelin',Comments:'每种语言一个页签。填写名称与描述后保存为 XLSX 并上传。空白翻译行跳过。'};
  for(const [lang,values] of groups){
    const sheet=X.utils.aoa_to_sheet([headers,...products.map(p=>{const r=values.get(p.productId);return [p.productId,r?.title||'',r?.description||''];})]);
    sheet['!cols']=[{wch:32},{wch:48},{wch:90}];sheet['!autofilter']={ref:sheet['!ref']};
    for(const cell of Object.values(sheet))if(cell&&cell.t==='s')cell.z='@';
    sheet.A1.c=[{a:'PlayBatch',t:'商品 ID，请保留原值。页签名是语言代码，请勿改成语言中文名称。'}];
    sheet.B1.c=[{a:'PlayBatch',t:'商品名称，1–55 个字符。名称和描述都为空时跳过该行。'}];
    sheet.C1.c=[{a:'PlayBatch',t:'商品描述，1–200 个字符。支持换行。请粘贴纯文本，不使用公式。'}];
    X.utils.book_append_sheet(wb,sheet,lang);
  }
  return Buffer.from(X.write(wb,{type:'buffer',bookType:'xlsx',compression:true}));
}
// Bound actual inflation, not just ZIP metadata, before the workbook parser allocates memory.
function inspectZip(bytes){
  if(!Buffer.isBuffer(bytes)||bytes.length>5*1024*1024||bytes.length<22)throw Error('XLSX 文件无效或超过 5MB，请分批导入');
  let end=-1;
  for(let i=bytes.length-22;i>=Math.max(0,bytes.length-65557);i--)if(bytes.readUInt32LE(i)===0x06054b50&&i+22+bytes.readUInt16LE(i+20)===bytes.length){end=i;break;}
  if(end<0)throw Error('不是有效的 XLSX 工作簿，请另存为 .xlsx');
  const count=bytes.readUInt16LE(end+10),offset=bytes.readUInt32LE(end+16);
  if(bytes.readUInt16LE(end+4)||bytes.readUInt16LE(end+6)||count>1000||!count||offset>=end)throw Error('不支持此 XLSX 压缩结构');
  let at=offset,total=0;const names=new Set();
  for(let i=0;i<count;i++){
    if(at+46>end||bytes.readUInt32LE(at)!==0x02014b50)throw Error('XLSX 压缩目录损坏');
    const flags=bytes.readUInt16LE(at+8),method=bytes.readUInt16LE(at+10),size=bytes.readUInt32LE(at+20),expanded=bytes.readUInt32LE(at+24),nl=bytes.readUInt16LE(at+28),extra=bytes.readUInt16LE(at+30),comment=bytes.readUInt16LE(at+32),local=bytes.readUInt32LE(at+42);
    const name=bytes.subarray(at+46,at+46+nl).toString('utf8');
    if(flags&1||![0,8].includes(method)||expanded>24*1024*1024||total+expanded>32*1024*1024||names.has(name)||/vbaProject\.bin$/i.test(name))throw Error('工作簿过大、加密、包含宏或结构不受支持');
    names.add(name);
    if(local+30>offset||bytes.readUInt32LE(local)!==0x04034b50||bytes.readUInt16LE(local+8)!==method)throw Error('XLSX 文件结构损坏');
    const localName=bytes.readUInt16LE(local+26),start=local+30+localName+bytes.readUInt16LE(local+28);
    if(bytes.subarray(local+30,local+30+localName).toString('utf8')!==name||start+size>offset)throw Error('XLSX 文件结构损坏');
    const input=bytes.subarray(start,start+size);
    let actual;try{actual=method===8?zlib.inflateRawSync(input,{maxOutputLength:24*1024*1024}):input;}catch{throw Error('XLSX 内容损坏或解压后过大');}
    if(actual.length!==expanded)throw Error('XLSX 文件大小校验失败');
    total+=actual.length;at+=46+nl+extra+comment;
  }
  if(at!==end||!names.has('xl/workbook.xml'))throw Error('请上传标准 XLSX 工作簿');
}
function readWorkbook(bytes){
  inspectZip(bytes);
  let wb;try{wb=X.read(bytes,{type:'buffer',cellFormula:true,cellHTML:false,cellNF:false,sheetRows:LIMIT+2});}catch{throw Error('无法读取 XLSX，请在 Excel 中重新另存为 .xlsx');}
  if(!wb.SheetNames.length||wb.SheetNames.length>100)throw Error('工作簿须包含 1–100 个语言页签');
  const rows=[],sheets=[],seenLanguages=new Set();let visited=0;
  for(const name of wb.SheetNames){
    const lang=language(name),sheet=wb.Sheets[name];
    if(seenLanguages.has(lang.toLowerCase()))throw Error('语言页签重复：'+name);seenLanguages.add(lang.toLowerCase());
    const range=X.utils.decode_range(sheet['!fullref']||sheet['!ref']||'A1');
    if(range.e.r>LIMIT||range.e.c>2)throw Error('页签 '+name+'：仅允许 productId、title、description 三列，且不得超过 '+LIMIT+' 行');
    function cell(row,col){
      const value=sheet[X.utils.encode_cell({r:row,c:col})];
      if(value?.f||value?.F)throw Error('页签 '+name+' 第 '+(row+1)+' 行：不支持公式，请粘贴为文本值');
      if(value&&value.t!=='s'&&value.t!=='z')throw Error('页签 '+name+' 第 '+(row+1)+' 行：请将商品 ID 和文案保存为文本');
      const text=String(value?.v??'');if(text.includes('\uFFFD')||text.includes('\u0000'))throw Error('页签 '+name+' 第 '+(row+1)+' 行：存在损坏字符');
      return text;
    }
    for(let c=0;c<3;c++)if(cell(0,c)!==headers[c])throw Error('页签 '+name+'：第一行表头必须为 productId、title、description');
    let filled=0,skipped=0;
    for(let r=1;r<=range.e.r;r++){
      if(++visited>LIMIT)throw Error('工作簿数据超过 '+LIMIT+' 行，请分批导入');
      const [id,title,description]=[cell(r,0),cell(r,1),cell(r,2)];
      if(!title.trim()&&!description.trim()){skipped++;continue;}
      rows.push({productId:id.trim(),languageCode:lang,title,description,sheet:name,row:r+1});filled++;
    }
    sheets.push({name,languageCode:lang,filled,skipped});
  }
  return {rows,sheets,csv:csv(rows)};
}
function importWorkbook(bytes,existing){
  const parsed=readWorkbook(bytes);
  if(!parsed.rows.length)throw Error('模板没有已填写的翻译，请填写名称和描述后再上传');
  try{return {products:C.importListingsCSV(parsed.csv,existing),sheets:parsed.sheets};}catch(e){
    const index=Number(e.message.match(/^第 (\d+) 行：/)?.[1])-2,source=parsed.rows[index];
    if(source)throw Error(e.message.replace(/^第 \d+ 行：/,'页签 '+source.sheet+' 第 '+source.row+' 行：'));throw e;
  }
}
function decode(value){if(typeof value!=='string'||value.length>7*1024*1024||!/^[A-Za-z0-9+/]*={0,2}$/.test(value))throw Error('XLSX 上传内容无效');return Buffer.from(value,'base64');}
module.exports={exportWorkbook,readWorkbook,importWorkbook,decode,MIME};
