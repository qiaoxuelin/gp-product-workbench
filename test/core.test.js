const {test}=require('node:test');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const C=require('../core'),schemas=JSON.parse(fs.readFileSync(path.join(__dirname,'../google-api-discovery.json'))).schemas;
const product=()=>({packageName:'com.example.test',productId:'coins_100',regionsVersion:{version:'2022/02'},listings:[{languageCode:'en-US',title:'100 coins',description:'A "coin" pack,\nsecond line'}],purchaseOptions:[{purchaseOptionId:'buy',state:'ACTIVE',buyOption:{legacyCompatible:true},regionalPricingAndAvailabilityConfigs:[{regionCode:'US',price:C.money('0.99','USD'),availability:'AVAILABLE'},{regionCode:'JP',price:C.money('150','JPY'),availability:'AVAILABLE'}]}],taxAndComplianceSettings:{isTokenizedDigitalAsset:false}});
test('prices retain decimal precision and currency-specific rounding',()=>{
  assert.equal(C.decimal(C.money('999999999.123456789','USD')),'999999999.123456789');
  assert.equal(C.decimal(C.adjust(C.money('0.99','USD'),'percent','10')),'1.09');
  assert.equal(C.decimal(C.adjust(C.money('155','JPY'),'percent','10')),'171');
  assert.equal(C.decimal(C.adjust(C.money('1.005','KWD'),'percent','10')),'1.106');
  for(const bad of ['-1','0','NaN','1e2','1.1234567890'])assert.throws(()=>C.money(bad,'USD'));
  assert.throws(()=>C.adjust(C.money('1','USD'),'percent','-100'));
});
test('price-only change preserves remote settings and strips only read-only fields',()=>{
  const before=product(),after=C.clone(before);after.purchaseOptions[0].regionalPricingAndAvailabilityConfigs[0].price=C.money('1.99','USD');
  assert.deepEqual(C.mask(before,after),['purchaseOptions']);
  assert.deepEqual(after.purchaseOptions[0].regionalPricingAndAvailabilityConfigs[1],before.purchaseOptions[0].regionalPricingAndAvailabilityConfigs[1]);
  assert.equal(C.writable(after).purchaseOptions[0].state,undefined);
  assert.equal(C.writable(after).regionsVersion,undefined);
  assert.deepEqual(C.writable(after).taxAndComplianceSettings,before.taxAndComplianceSettings);
  const changes=C.changes(before,after);assert.equal(changes.length,1);assert.match(changes[0].path,/US.price$/);
});
test('CSV roundtrip multiline, quotes, non-ASCII and merge preserves omitted region and advanced settings',()=>{
  const p=product();p.listings[0].title='金币, "礼包"';
  const csv=C.exportCSV([p]);assert.deepEqual(C.importCSV(csv,[p],p.packageName),[p]);
  const subset=C.clone(p);subset.purchaseOptions[0].regionalPricingAndAvailabilityConfigs.splice(1);subset.purchaseOptions[0].regionalPricingAndAvailabilityConfigs[0].price=C.money('2.99','USD');
  const [merged]=C.importCSV(C.exportCSV([subset]),[p],p.packageName);
  assert.equal(merged.purchaseOptions[0].regionalPricingAndAvailabilityConfigs.length,2);
  assert.deepEqual(merged.taxAndComplianceSettings,p.taxAndComplianceSettings);
  assert.equal(merged.purchaseOptions[0].state,'ACTIVE');
  assert.equal(C.decimal(merged.purchaseOptions[0].regionalPricingAndAvailabilityConfigs[0].price),'2.99');
});
test('CSV conflicting duplicate rows fail atomically',()=>{
  const p=product(),csv=C.exportCSV([p]);const lines=csv.split('\r\n');
  assert.throws(()=>C.importCSV(csv+'\r\n'+lines[1].replace('"0.99"','"1.99"'),[p],p.packageName),/冲突/);
  assert.throws(()=>C.parseCSV('a,b\n"unclosed,b'),/闭合/);
  assert.equal(C.decimal(p.purchaseOptions[0].regionalPricingAndAvailabilityConfigs[0].price),'0.99');
});
test('validates identifiers, locales, length, duplicate regions, exclusive option types and unknown fields',()=>{
  C.validate(product(),schemas);
  for(const mutate of [
    p=>p.productId='INVALID',p=>p.listings[0].title='x'.repeat(56),
    p=>p.purchaseOptions[0].rentOption={rentalPeriod:'P1D'},
    p=>p.purchaseOptions[0].regionalPricingAndAvailabilityConfigs.push(p.purchaseOptions[0].regionalPricingAndAvailabilityConfigs[0]),
    p=>p.hallucinatedField=true,p=>p.purchaseOptions[0].regionalPricingAndAvailabilityConfigs[0].price.nanos=-1
  ]){const p=product();mutate(p);assert.throws(()=>C.validate(p,schemas));}
});

test('language-only template merges locales without altering commercial configuration',()=>{
  const p=product(),snapshot=C.clone(p);
  const csv='\uFEFFproductId,languageCode,title,description\r\ncoins_100,zh-CN,100金币,购买获得100金币\r\ncoins_100,en-US,New title,New description';
  const [result]=C.importListingsCSV(csv,[p]);
  assert.equal(result.listings.length,2);
  assert.equal(result.listings.find(l=>l.languageCode==='zh-CN').title,'100金币');
  assert.deepEqual(result.purchaseOptions,snapshot.purchaseOptions);
  assert.deepEqual(result.taxAndComplianceSettings,snapshot.taxAndComplianceSettings);
  assert.deepEqual(p,snapshot);
  assert.deepEqual(C.mask(p,result),['listings']);
  const template=C.exportListingsCSV([p],['zh-TW']);
  assert(template.includes('"zh-TW","",""'));
  assert.throws(()=>C.importListingsCSV(csv+'\r\ncoins_100,zh-cn,冲突,不同内容',[p]),/冲突/);
  assert.throws(()=>C.importListingsCSV(csv.replace('coins_100','missing'),[p]),/不在当前导入范围/);
});

test('ALL CSV expands each price tier, caches translations and rejects ambiguous regions',async()=>{
  const header='productId,purchaseOptionId,languageCode,title,description,regionCode,currencyCode,price,availability\n';
  const input=header+'coins_100,buy,en-US,Coins,Get coins,ALL,USD,1.99,AVAILABLE\ncoins_100,buy,zh-CN,金币,获得金币,ALL,USD,1.99,AVAILABLE\ncoins_500,buy,en-US,More coins,Get more,ALL,USD,4.99,AVAILABLE';
  const calls=[];
  const convert=async price=>{calls.push(price);return {regionVersion:{version:'2025/03'},convertedRegionPrices:{US:{price},JP:{price:C.money(price.units==='1'?'300':'750','JPY')}}};};
  const expanded=await C.expandAllRegionsCSV(input,[],convert);
  assert.equal(calls.length,2);
  assert.equal(expanded.allOptions,2);
  const products=C.importCSV(expanded.csv,[],'com.example.test');
  assert.equal(products.length,2);
  assert.equal(products[0].listings.length,2);
  assert.equal(products[0].purchaseOptions[0].regionalPricingAndAvailabilityConfigs.length,2);
  assert.equal(products[1].purchaseOptions[0].regionalPricingAndAvailabilityConfigs[1].price.units,'750');
  assert.equal(expanded.versions.get('coins_100').version,'2025/03');
  await assert.rejects(()=>C.expandAllRegionsCSV(input+'\ncoins_100,buy,en-US,Coins,Get coins,US,USD,1.99,AVAILABLE',[],convert),/不能混用/);
  await assert.rejects(()=>C.expandAllRegionsCSV(input.replace('ALL,USD,4.99,AVAILABLE','ALL,USD,4.99,NO_LONGER_AVAILABLE'),[],convert),/availability/);
});
