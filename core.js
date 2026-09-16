'use strict';
const crypto = require('node:crypto');
const clone = v => structuredClone(v);
function stable(v) {
  if (Array.isArray(v)) return v.map(stable);
  if (v && typeof v === 'object') return Object.fromEntries(Object.keys(v).sort().map(k=>[k,stable(v[k])]));
  return v;
}
const equal = (a,b) => JSON.stringify(stable(a))===JSON.stringify(stable(b));
function money(text, currency) {
  if (!/^[A-Z]{3}$/.test(currency)) throw Error('币种须为三位大写代码');
  const s=String(text).trim();
  if (!/^\d+(\.\d{1,9})?$/.test(s)) throw Error('价格须为正数，最多 9 位小数');
  const [u,f='']=s.split('.');
  const n=BigInt(u)*1000000000n+BigInt(f.padEnd(9,'0'));
  if(n<=0n || BigInt(u)>9223372036854775807n) throw Error('价格超出范围');
  return {currencyCode:currency,units:String(BigInt(u)),nanos:Number(n%1000000000n)};
}
function decimal(m) {
  return String(m.units||'0') + ((m.nanos||0)?'.'+String(m.nanos).padStart(9,'0').replace(/0+$/,''):'');
}
function adjust(m, mode, value) {
  if(mode==='fixed') return money(value,m.currencyCode);
  if(mode!=='percent' || !/^-?\d+(\.\d{1,4})?$/.test(String(value))) throw Error('调价比例须为数字，最多 4 位小数');
  const negative=String(value).startsWith('-'), [u,f='']=String(value).replace(/^-/,'').split('.');
  const pct=(BigInt(u)*10000n+BigInt(f.padEnd(4,'0')))*(negative?-1n:1n);
  if(pct<=-1000000n) throw Error('降价比例必须小于 100%');
  const digits=new Intl.NumberFormat('en',{style:'currency',currency:m.currencyCode}).resolvedOptions().maximumFractionDigits;
  const quantum=10n**BigInt(9-digits);
  const raw=(BigInt(m.units||0)*1000000000n+BigInt(m.nanos||0))*(1000000n+pct);
  const rounded=(raw+1000000n*quantum/2n)/(1000000n*quantum)*quantum;
  return money(String(rounded/1000000000n)+'.'+String(rounded%1000000000n).padStart(9,'0'),m.currencyCode);
}
function writable(p) {
  const c=clone(p); delete c.regionsVersion;
  for(const o of c.purchaseOptions||[]) delete o.state;
  return c;
}
const fields=['listings','purchaseOptions','taxAndComplianceSettings','restrictedPaymentCountries','offerTags'];
function mask(before,after) {
  if(!before) return fields.filter(k=>after[k]!==undefined);
  return fields.filter(k=>!equal(writable(before)[k],writable(after)[k]));
}
function validate(p, schemas) {
  const errors=[];
  function schema(v,name,path) {
    const def=schemas[name];
    if(!def || !v || typeof v!=='object' || Array.isArray(v)) {errors.push(path+'：须为对象');return;}
    for(const [k,x] of Object.entries(v)) {
      const s=def.properties?.[k]; const at=path+'.'+k;
      if(!s){errors.push(at+'：未知字段');continue;}
      if(s.$ref) schema(x,s.$ref,at);
      else if(s.type==='array') {
        if(!Array.isArray(x)){errors.push(at+'：须为数组');continue;}
        x.forEach((a,i)=>s.items.$ref?schema(a,s.items.$ref,at+'['+i+']'):null);
      } else if(s.type==='object') {
        if(!x || typeof x!=='object' || Array.isArray(x)) errors.push(at+'：须为对象');
      } else if(s.type==='integer') {
        if(!Number.isInteger(x)) errors.push(at+'：须为整数');
      } else if(typeof x!==s.type) errors.push(at+'：类型应为 '+s.type);
      if(s.enum && !s.enum.includes(x)) errors.push(at+'：无效选项');
    }
  }
  schema(p,'OneTimeProduct',p.productId||'商品');
  if(!/^[a-zA-Z]\w*(\.[a-zA-Z]\w*)+$/.test(p.packageName||'')) errors.push('应用包名格式错误');
  if(!/^[a-z0-9][a-z0-9_.]*$/.test(p.productId||'')) errors.push('商品 ID 仅允许小写字母、数字、下划线和点，且以字母或数字开头');
  function unique(items,key,label) {
    const ids=items.map(x=>x[key]); if(new Set(ids).size!==ids.length) errors.push(label+'不能重复');
  }
  if(!Array.isArray(p.listings)||!p.listings.length) errors.push('至少填写一种语言');
  else {
    unique(p.listings,'languageCode','语言');
    for(const l of p.listings) {
      try {Intl.getCanonicalLocales(l.languageCode||'!');}catch{errors.push('语言代码无效');}
      if(!l.title?.trim()||[...l.title].length>55) errors.push('名称须为 1–55 个字符');
      if(!l.description?.trim()||[...l.description].length>200) errors.push('描述须为 1–200 个字符');
    }
  }
  if(!Array.isArray(p.purchaseOptions)||!p.purchaseOptions.length) errors.push('至少填写一个购买选项');
  else {
    unique(p.purchaseOptions,'purchaseOptionId','购买选项 ID');
    if(p.purchaseOptions.filter(o=>o.buyOption?.legacyCompatible).length>1) errors.push('只能有一个兼容旧版的购买选项');
    for(const o of p.purchaseOptions) {
      if(!/^[a-z0-9][a-z0-9-]{0,62}$/.test(o.purchaseOptionId||'')) errors.push('购买选项 ID 格式错误');
      if(('buyOption' in o)===('rentOption' in o)) errors.push('购买与租赁须选择一种');
      if(o.rentOption && !o.rentOption.rentalPeriod) errors.push('租赁须填写租期');
      const regions=o.regionalPricingAndAvailabilityConfigs;
      if(!Array.isArray(regions)||!regions.length) {errors.push('至少配置一个地区价格');continue;}
      unique(regions,'regionCode','地区');
      for(const r of regions) {
        if(!/^[A-Z]{2}$/.test(r.regionCode||'')) errors.push('地区须为两位大写代码');
        if(!['AVAILABLE','NO_LONGER_AVAILABLE','AVAILABLE_IF_RELEASED','AVAILABLE_FOR_OFFERS_ONLY'].includes(r.availability)) errors.push('地区销售状态无效');
        try {
          if(!r.price || !Number.isInteger(r.price.nanos||0) || (r.price.nanos||0)<0 || (r.price.nanos||0)>999999999) throw Error('金额精度错误');
          money(decimal(r.price),r.price.currencyCode);
        }catch(e){errors.push(r.regionCode+'：'+e.message);}
      }
      if((o.offerTags||[]).length>20) errors.push('购买选项标签最多 20 个');
    }
  }
  if((p.offerTags||[]).length>20) errors.push('商品标签最多 20 个');
  if(errors.length) throw Error([...new Set(errors)].join('；'));
}
function changes(before,after,path='') {
  if(equal(before,after)) return [];
  if(before?.currencyCode&&after?.currencyCode) return [{path,before:before.currencyCode+' '+decimal(before),after:after.currencyCode+' '+decimal(after)}];
  if(Array.isArray(before)||Array.isArray(after)) {
    const a=before||[],b=after||[];
    const key=['purchaseOptionId','languageCode','regionCode'].find(k=>[...a,...b].length && [...a,...b].every(x=>x&&x[k]));
    if(key) {
      const aa=Object.fromEntries(a.map(x=>[x[key],x])),bb=Object.fromEntries(b.map(x=>[x[key],x]));
      return changes(aa,bb,path);
    }
  }
  if((before===undefined||before&&typeof before==='object'&&!Array.isArray(before)) && (after===undefined||after&&typeof after==='object'&&!Array.isArray(after))) {
    return [...new Set([...Object.keys(before||{}),...Object.keys(after||{})])].flatMap(k=>changes(before?.[k],after?.[k],path?path+'.'+k:k));
  }
  return [{path,before:before??null,after:after??null}];
}
function parseCSV(text) {
  text=text.replace(/^\uFEFF/,'');
  const rows=[],rowLines=[]; let row=[],s='',q=false,line=1,startLine=1;
  for(let i=0;i<text.length;i++){
    const c=text[i];
    if(c==='\r'||c==='\n'&&text[i-1]!=='\r')line++;
    if(c==='"'){if(q&&text[i+1]==='"'){s+='"';i++;}else if(q||s==='') q=!q;else throw Error('CSV 第 '+line+' 行引号格式错误');}
    else if(c===','&&!q){row.push(s);s='';}
    else if((c==='\n'||c==='\r')&&!q){if(c==='\r'&&text[i+1]==='\n')i++;row.push(s);if(row.some(Boolean)){rows.push(row);rowLines.push(startLine);}row=[];s='';startLine=line;}
    else s+=c;
  }
  if(q) throw Error('CSV 第 '+startLine+' 行引号未闭合');
  row.push(s);if(row.some(Boolean)){rows.push(row);rowLines.push(startLine);}
  if(!rows.length)throw Error('CSV 为空');
  const headers=rows.shift();rowLines.shift();
  if(new Set(headers).size!==headers.length)throw Error('CSV 表头重复');
  return rows.map((r,i)=>{if(r.length!==headers.length)throw Error('CSV 第 '+rowLines[i]+' 行列数不符');return Object.fromEntries(headers.map((h,j)=>[h,r[j]]));});
}
const csvHeaders=['productId','purchaseOptionId','languageCode','title','description','regionCode','currencyCode','price','availability'];
function importCSV(text,existing,packageName) {
  const rows=parseCSV(text), map=new Map(existing.map(p=>[p.productId,clone(p)])),seen=new Map(),touched=new Set();
  for(const r of rows) {
    for(const k of csvHeaders) if(!(k in r))throw Error('CSV 缺少列：'+k);
    if(!r.productId||!r.purchaseOptionId||!r.languageCode||!r.regionCode)throw Error('商品、购买选项、语言、地区不能为空');
    let p=map.get(r.productId);
    if(!p){p={packageName,productId:r.productId,listings:[],purchaseOptions:[]};map.set(r.productId,p);}
    const l={languageCode:r.languageCode,title:r.title,description:r.description};
    const region={regionCode:r.regionCode,price:money(r.price,r.currencyCode),availability:r.availability||'AVAILABLE'};
    for(const [key,value] of [[r.productId+'/lang/'+r.languageCode,l],[r.productId+'/'+r.purchaseOptionId+'/'+r.regionCode,region]]) {
      if(seen.has(key)&&!equal(seen.get(key),value))throw Error('CSV 重复行冲突：'+key);
      seen.set(key,value);
    }
    const li=p.listings.findIndex(x=>x.languageCode===l.languageCode);
    if(li<0)p.listings.push(l);else p.listings[li]=l;
    let o=p.purchaseOptions.find(x=>x.purchaseOptionId===r.purchaseOptionId);
    if(!o){o={purchaseOptionId:r.purchaseOptionId,buyOption:{},regionalPricingAndAvailabilityConfigs:[]};p.purchaseOptions.push(o);}
    const ri=o.regionalPricingAndAvailabilityConfigs.findIndex(x=>x.regionCode===region.regionCode);
    if(ri<0)o.regionalPricingAndAvailabilityConfigs.push(region);else o.regionalPricingAndAvailabilityConfigs[ri]=region;
    touched.add(p.productId);
  }
  return [...touched].map(id=>map.get(id));
}
function exportCSV(products) {
  const lines=[csvHeaders];
  for(const p of products)for(const o of p.purchaseOptions||[])for(const l of p.listings||[])for(const r of o.regionalPricingAndAvailabilityConfigs||[])
    lines.push([p.productId,o.purchaseOptionId,l.languageCode,l.title,l.description,r.regionCode,r.price?.currencyCode,r.price?decimal(r.price):'',r.availability]);
  return '\uFEFF'+lines.map(row=>row.map(v=>'"'+String(v??'').replace(/"/g,'""')+'"').join(',')).join('\r\n');
}
const listingHeaders=['productId','languageCode','title','description'];
function importListingsCSV(text,existing) {
  const rows=parseCSV(text),map=new Map(existing.map(p=>[p.productId,clone(p)])),seen=new Map(),touched=new Set();
  if(!rows.length)throw Error('模板没有数据行');
  for(const [index,r] of rows.entries()){
    const line='第 '+(index+2)+' 行：';
    for(const h of listingHeaders)if(!(h in r))throw Error(line+'缺少列 '+h);
    if(Object.keys(r).some(k=>!listingHeaders.includes(k)))throw Error(line+'多语言模板只允许 productId、languageCode、title、description 四列');
    const id=r.productId.trim(),p=map.get(id);
    if(!p)throw Error(line+'商品 '+id+' 不在当前导入范围；请先创建/读取该商品，或调整所选范围');
    let languageCode;try{languageCode=Intl.getCanonicalLocales(r.languageCode.trim())[0];if(!languageCode)throw Error();}catch{throw Error(line+'语言代码无效');}
    const listing={languageCode,title:r.title,description:r.description};
    if(!listing.title.trim()||[...listing.title].length>55)throw Error(line+'名称须为 1–55 个字符');
    if(!listing.description.trim()||[...listing.description].length>200)throw Error(line+'描述须为 1–200 个字符');
    const key=id+'/'+languageCode;
    if(seen.has(key)&&!equal(seen.get(key),listing))throw Error(line+'重复语言内容冲突：'+key);
    seen.set(key,listing);
    const i=p.listings.findIndex(l=>l.languageCode.toLowerCase()===languageCode.toLowerCase());
    if(i<0)p.listings.push(listing);else p.listings[i]={...p.listings[i],...listing};
    touched.add(id);
  }
  return [...touched].map(id=>map.get(id));
}
function exportListingsCSV(products,languages=[]) {
  const normalized=[...new Set(languages.map(l=>{try{const c=Intl.getCanonicalLocales(l.trim())[0];if(!c)throw Error();return c;}catch{throw Error('语言代码无效：'+l);}}))];
  const lines=[listingHeaders];
  for(const p of products){
    for(const l of p.listings)lines.push([p.productId,l.languageCode,l.title,l.description]);
    for(const lang of normalized)if(!p.listings.some(l=>l.languageCode.toLowerCase()===lang.toLowerCase()))lines.push([p.productId,lang,'','']);
  }
  return '\uFEFF'+lines.map(row=>row.map(v=>'"'+String(v??'').replace(/"/g,'""')+'"').join(',')).join('\r\n');
}
async function expandAllRegionsCSV(text,existing,convert) {
  const rows=parseCSV(text),groups=new Map(),versions=new Map(),cache=new Map(),expanded=[];
  for(const r of rows){
    for(const h of csvHeaders)if(!(h in r))throw Error('CSV 缺少列：'+h);
    const key=r.productId+'/'+r.purchaseOptionId,all=r.regionCode.trim().toUpperCase()==='ALL';
    if(all&&r.availability&&r.availability!=='AVAILABLE')throw Error('ALL 行的 availability 必须为 AVAILABLE 或留空');
    const signature=all?JSON.stringify(money(r.price,r.currencyCode)):null;
    const prior=groups.get(key);
    if(prior&&(prior.all!==all||all&&prior.signature!==signature))throw Error(key+'：同一购买选项不能混用 ALL 与单地区行，且 ALL 的基准价必须一致');
    groups.set(key,{all,signature});
  }
  for(const r of rows){
    if(r.regionCode.trim().toUpperCase()!=='ALL'){expanded.push(r);continue;}
    const category=existing.find(p=>p.productId===r.productId)?.taxAndComplianceSettings?.productTaxCategoryCode;
    const price=money(r.price,r.currencyCode),cacheKey=JSON.stringify({price,category});
    let result=cache.get(cacheKey);
    if(!result){result=await convert(price,category);cache.set(cacheKey,result);}
    if(!result.regionVersion?.version)throw Error('Google 未返回地区版本，未导入');
    const regions=Object.entries(result.convertedRegionPrices||{});
    if(!regions.length)throw Error('Google 未返回地区价格，未导入');
    versions.set(r.productId,result.regionVersion);
    for(const [code,region] of regions){
      if(!region.price)throw Error('Google 缺少地区价格：'+code);
      expanded.push({...r,regionCode:region.regionCode||code,currencyCode:region.price.currencyCode,price:decimal(region.price),availability:'AVAILABLE'});
    }
  }
  const csv='\uFEFF'+[csvHeaders,...expanded.map(r=>csvHeaders.map(h=>r[h]))].map(row=>row.map(v=>'"'+String(v??'').replace(/"/g,'""')+'"').join(',')).join('\r\n');
  return {csv,versions,allOptions:[...groups.values()].filter(g=>g.all).length,expandedRows:expanded.length};
}
module.exports={expandAllRegionsCSV,importListingsCSV,exportListingsCSV,clone,equal,money,decimal,adjust,writable,mask,validate,changes,parseCSV,importCSV,exportCSV,hash:v=>crypto.createHash('sha256').update(JSON.stringify(stable(v))).digest('hex')};
