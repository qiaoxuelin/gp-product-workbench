const {test,expect}=require('@playwright/test');
async function mockProjects(page,platform,profiles){await page.route('**/api/projects',r=>r.fulfill({json:{revision:'fixture',profiles:{google:platform==='google'?profiles:[],apple:platform==='apple'?profiles:[]},projects:profiles.map(p=>({id:platform+':'+p.id,name:p.name,googleId:platform==='google'?p.id:'',appleId:platform==='apple'?p.id:''}))}}));}

test('Apple project, draft editing, import preview, reload and Google navigation',async({page})=>{
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('/apple.html');await page.locator('#workspaceCreate').click();await page.locator('#workspaceName').fill('Apple UI');await page.getByRole('button',{name:'保存项目',exact:true}).click();await page.getByRole('button',{name:'配置 App Store',exact:true}).click();
 await page.locator('#profileName').fill('Apple UI');await page.locator('#profileApp').fill('123456789');await page.locator('#profileBundle').fill('com.test.appleui');await page.locator('#profileKey').fill('ABCDEFGHIJ');await page.locator('#profileIssuer').fill('12345678-1234-1234-1234-123456789abc');await page.getByRole('button',{name:'保存 App Store 设置'}).click();
 await expect(page.locator('#modal')).not.toBeVisible();await page.getByRole('button',{name:'新建商品',exact:false}).click();
 await page.locator('#editId').fill('coins_100');await page.locator('#editName').fill('Coins 100');await page.getByRole('textbox',{name:'显示名称',exact:true}).fill('100 Coins');await page.getByRole('textbox',{name:'描述',exact:true}).fill('Receive 100 coins');await page.getByRole('button',{name:'保存草稿'}).click();
 await expect(page.locator('#products')).toContainText('coins_100');await page.reload();await expect(page.locator('#products')).toContainText('coins_100');
 await page.getByRole('button',{name:'导入 CSV'}).click();
 await page.locator('#csvFieldHelp summary').click();
 await expect(page.locator('#csvFieldHelp')).toContainText('不是销售地区列表');
 const downloaded=page.waitForEvent('download');await page.getByRole('button',{name:'下载模板',exact:true}).click();
 const template=await downloaded;expect(template.suggestedFilename()).toBe('apple-products-template.csv');
 const chunks=[];for await(const chunk of await template.createReadStream())chunks.push(chunk);const templateBuffer=Buffer.concat(chunks),templateText=templateBuffer.toString('utf8');
 const rows=require('../core').parseCSV(templateText),products=require('../apple-products').importCSV(templateText);
 expect(rows).toHaveLength(4);expect(Object.keys(rows[0])).toEqual(['productId','name','inAppPurchaseType','reviewNote','locale','displayName','description','territory','currency','price']);
 expect(products.map(p=>p.inAppPurchaseType)).toEqual(['CONSUMABLE','NON_CONSUMABLE']);
 for(const product of products){expect(product.reviewNote).not.toBe('');expect(product.localizations.map(l=>l.locale)).toEqual(['zh-Hans','en-US']);expect(product.initialPrice).toMatchObject({territory:'USA',currency:'USD'});expect(Number(product.initialPrice.price)).toBeGreaterThan(0);}
 await page.locator('#csvFile').setInputFiles({name:'apple-products-template.csv',mimeType:'text/csv',buffer:templateBuffer});
 await page.getByRole('button',{name:'检查导入'}).click();await expect(page.locator('#dialogBody')).toContainText('将合并 2 个商品');
 await expect(page.locator('#dialogBody')).toContainText('0.99');await expect(page.locator('#dialogBody')).toContainText('2.99');await expect(page.locator('#dialogBody')).toContainText('en-US');
 await page.getByRole('button',{name:'返回',exact:true}).click();
 await page.locator('#csvFile').setInputFiles({name:'apple.csv',mimeType:'text/csv',buffer:Buffer.from('productId,name,inAppPurchaseType,locale,displayName,description\nremove_ads,Remove Ads,NON_CONSUMABLE,en-US,Remove Ads,Permanently remove ads')});
 await page.getByRole('button',{name:'检查导入'}).click();await expect(page.getByRole('heading',{name:'核对导入草稿'})).toBeVisible();await page.getByRole('button',{name:'应用到本机草稿'}).click();await expect(page.locator('#products')).toContainText('非消耗型');
 await page.getByRole('checkbox',{name:'选择 remove_ads',exact:true}).check();await page.getByRole('button',{name:'撤销所选草稿'}).click();await page.getByRole('button',{name:'确认撤销'}).click();await expect(page.locator('#products')).not.toContainText('remove_ads');
 await page.getByRole('button',{name:'预览更改'}).click();await expect(page.locator('#status')).toContainText('请先导入');
 const historical={productId:'coins_100',name:'Older target',inAppPurchaseType:'CONSUMABLE',reviewNote:'',localizations:[]};
 await page.route('**/api/apple/history',r=>r.fulfill({json:{operations:[{file:'test-operation',startedAt:'2026-09-20',results:[{}]}]}}));
 await page.route('**/api/apple/reconcile',r=>r.fulfill({json:{results:[{productId:'coins_100',status:'verified',target:historical,actual:{...historical,id:'remote',state:'MISSING_METADATA'}}]}}));
 await page.getByRole('button',{name:'操作记录',exact:true}).click();await page.getByRole('button',{name:'核对结果',exact:true}).click();await expect(page.getByRole('heading',{name:'远端核对结果'})).toBeVisible();await expect(page.locator('#status')).toHaveText('核对完成，请查看逐项结果');await page.getByRole('button',{name:'关闭',exact:true}).last().click();
 await expect(page.locator('#products')).toContainText('Coins 100');await expect(page.locator('#products')).not.toContainText('Older target');
 await page.screenshot({path:'data/apple-ui-desktop.png',fullPage:true});
 await page.setViewportSize({width:900,height:850});await expect(page.getByRole('heading',{name:'内购商品',exact:true})).toBeVisible();
 await page.locator('[data-platform=google]').click();await expect(page.locator('#platformMissing')).toContainText('Google Play');await expect(page.locator('#workspaceShell h1')).toHaveText('Apple UI');
 expect(errors).toEqual([]);
});

test('Apple failed remote read cannot replace a local draft while readable items can load',async({page})=>{
 const profile={id:'reconcile-test',name:'Reconcile test',appId:'123456',bundleId:'com.test.reconcile'};
 const product=(id,name)=>({productId:id,name,inAppPurchaseType:'CONSUMABLE',reviewNote:'',localizations:[]});
 const localA=product('keep','Keep my draft'),localB=product('load','Local B'),remoteB={id:'remote-b',...product('load','Remote B'),state:'MISSING_METADATA',version:null,priceSchedule:null};
 await page.route('**/api/apple/config',r=>r.fulfill({json:{profiles:[profile],activeId:profile.id,current:profile}}));await mockProjects(page,'apple',[profile]);
 await page.addInitScript(({profile,draft})=>localStorage.setItem('apple-workspace-v1:'+profile.id+':'+profile.appId,JSON.stringify({base:[],draft})),{profile,draft:[localA,localB]});
 await page.route('**/api/apple/history',r=>r.fulfill({json:{operations:[{file:'test',startedAt:'2026-09-20',results:[{},{}]}]}}));
 await page.route('**/api/apple/reconcile',r=>r.fulfill({json:{results:[
  {productId:'keep',status:'pending',canLoadCurrent:false,message:'read failed',target:product('keep','Old target')},
  {productId:'load',status:'pending',canLoadCurrent:true,actual:remoteB,target:localB}
 ]}}));
 await page.goto('/apple.html');await page.getByRole('button',{name:'操作记录',exact:true}).click();await page.getByRole('button',{name:'核对结果',exact:true}).click();
 await expect(page.locator('#dialogBody')).toContainText('当前值未读取成功，本机草稿保留');
 await page.getByRole('button',{name:'载入 1 个未完成项的当前值',exact:true}).click();
 await expect(page.locator('#products')).toContainText('Keep my draft');await expect(page.locator('#products')).toContainText('Remote B');await expect(page.locator('#products')).not.toContainText('Old target');
 const saved=await page.evaluate(key=>JSON.parse(localStorage.getItem(key)),'apple-workspace-v1:'+profile.id+':'+profile.appId);
 expect(saved.draft.find(p=>p.productId==='keep').name).toBe('Keep my draft');expect(saved.base.map(p=>p.productId)).toEqual(['load']);
});
test('Apple confirmation freezes target and clears only the verified draft',async({page})=>{
 const profile={id:'confirm-test',name:'Confirmation test',appId:'123456',bundleId:'com.test.confirm'};
 const after={productId:'coins',name:'Coins',inAppPurchaseType:'CONSUMABLE',reviewNote:'',localizations:[]};let writes=0;
 await page.route('**/api/apple/config',r=>r.fulfill({json:{profiles:[profile],activeId:profile.id,current:profile}}));await mockProjects(page,'apple',[profile]);
 await page.addInitScript(({profile,after})=>localStorage.setItem('apple-workspace-v1:'+profile.id+':'+profile.appId,JSON.stringify({base:[],draft:[after]})),{profile,after});
 await page.route('**/api/apple/preview',r=>r.fulfill({json:{id:'plan',profileId:profile.id,appId:profile.appId,bundleId:profile.bundleId,entries:[{after,changes:[{path:'name',after:'Coins'}]}]}}));
 await page.route('**/api/apple/commit',r=>{writes++;const body=r.request().postDataJSON();expect(body.platform).toBe('apple');expect(body.profileId).toBe(profile.id);expect(body.appId).toBe(profile.appId);return r.fulfill({json:{logFile:'test',results:[{productId:'coins',status:'verified',completed:['create'],actual:{...after,id:'remote',state:'MISSING_METADATA'}}]}});});
 await page.goto('/apple.html');await page.getByRole('button',{name:'预览更改'}).click();await expect(page.getByRole('heading',{name:'确认上传到苹果'})).toBeVisible();expect(writes).toBe(0);await expect(page.locator('#status')).toHaveText('预览完成，请核对差异后确认上传');
 await page.getByRole('button',{name:'确认上传 1 个商品'}).click();await expect(page.getByRole('heading',{name:'苹果上传结果'})).toBeVisible();expect(writes).toBe(1);await expect(page.locator('#status')).toHaveText('上传结束，1/1 个商品已核对一致');await expect(page.locator('#dirtyCount')).toHaveText('0');
});


async function auditProfile(page,id,draft=[],base=[]){
 const profile={id,name:id,appId:'123456',bundleId:'com.test.'+id};
 await page.route('**/api/apple/config',r=>r.fulfill({json:{profiles:[profile],activeId:id,current:profile}}));await mockProjects(page,'apple',[profile]);
 await page.addInitScript(({profile,draft,base})=>localStorage.setItem('apple-workspace-v1:'+profile.id+':'+profile.appId,JSON.stringify({base,draft})),{profile,draft,base});
 return profile;
}
const auditProduct=(id='coins',name='Coins')=>({productId:id,name,inAppPurchaseType:'CONSUMABLE',reviewNote:'',localizations:[{locale:'en-US',name:'Coins',description:'Receive coins'}]});

for(const action of ['save','import'])test('Apple '+action+' locks Escape and project switching while a delayed request is pending',async({page})=>{
 const profiles=[{id:'delayed-a',name:'Project A',appId:'100001',bundleId:'com.test.a'},{id:'delayed-b',name:'Project B',appId:'100002',bundleId:'com.test.b'}];let active=profiles[0];
 await page.route('**/api/apple/config',r=>r.fulfill({json:{profiles,activeId:active.id,current:active}}));await mockProjects(page,'apple',profiles);
 await page.route('**/api/apple/config/switch',r=>{active=profiles.find(p=>p.id===r.request().postDataJSON().id);return r.fulfill({json:{profiles,activeId:active.id,current:active}})});
 let release,received;const started=new Promise(r=>received=r),gate=new Promise(r=>release=r);
 await page.route('**/api/apple/'+(action==='save'?'validate':'import'),async r=>{expect(r.request().postDataJSON().profileId).toBe(profiles[0].id);received();await gate;await r.fulfill({json:action==='save'?{valid:true}:{products:[auditProduct('coins','Belongs to A')]}})});
 await page.goto('/apple.html');
 if(action==='save'){
  await page.getByRole('button',{name:'新建商品',exact:false}).click();await page.locator('#editId').fill('coins');await page.locator('#editName').fill('Belongs to A');await page.getByRole('textbox',{name:'显示名称',exact:true}).fill('Coins');await page.getByRole('textbox',{name:'描述',exact:true}).fill('Receive coins');await page.getByRole('button',{name:'保存草稿',exact:true}).click();
 }else{
  await page.getByRole('button',{name:'导入 CSV',exact:true}).click();await page.locator('#csvFile').setInputFiles({name:'test.csv',mimeType:'text/csv',buffer:Buffer.from('test')});await page.getByRole('button',{name:'检查导入',exact:true}).click();
 }
 await started;await page.keyboard.press('Escape');await expect(page.locator('#modal')).toBeVisible();await expect(page.locator('#workspaceProject')).toBeDisabled();await expect(page.locator('#closeModal')).toBeDisabled();
 release();if(action==='import')await page.getByRole('button',{name:'应用到本机草稿',exact:true}).click();
 await expect(page.locator('#modal')).not.toBeVisible();await expect(page.locator('#products')).toContainText('Belongs to A');
 await page.locator('#workspaceProject').selectOption('apple:delayed-b');await expect(page.locator('#workspaceShell h1')).toHaveText('Project B');await expect(page.locator('#products')).not.toContainText('Belongs to A');
 const saved=await page.evaluate(()=>Object.fromEntries(Object.keys(localStorage).filter(k=>k.startsWith('apple-workspace-v1:')).map(k=>[k,JSON.parse(localStorage.getItem(k))])));
 expect(saved['apple-workspace-v1:delayed-a:100001'].draft[0].name).toBe('Belongs to A');expect(saved['apple-workspace-v1:delayed-b:100002']?.draft||[]).toEqual([]);
});

for(const newPrice of [false,true])test('Apple reconciliation updates the original snapshot and retains newer edits'+(newPrice?' including a different pending price':''),async({page})=>{
 const target={...auditProduct(),initialPrice:{territory:'USA',currency:'USD',price:'0.99'}},actual={...auditProduct(),id:'remote',state:'MISSING_METADATA',version:null,priceSchedule:{id:'schedule'}},current={...target,name:'Newer name',...(newPrice?{initialPrice:{territory:'USA',currency:'USD',price:'2.99'}}:{})};
 const profile=await auditProfile(page,'rebase',[current]);
 await page.route('**/api/apple/history',r=>r.fulfill({json:{operations:[{file:'history',startedAt:'today',results:[]}]}}));
 await page.route('**/api/apple/reconcile',r=>r.fulfill({json:{results:[{productId:'coins',status:'verified',before:null,target,actual,canLoadCurrent:true}]}}));
 let previewBody;await page.route('**/api/apple/preview',r=>{previewBody=r.request().postDataJSON();return r.fulfill({json:{id:'plan',appId:profile.appId,profileId:profile.id,entries:[{after:previewBody.items[0].after,changes:[{path:'name',after:'Newer name'}]}]}})});
 await page.goto('/apple.html');await page.getByRole('button',{name:'操作记录',exact:true}).click();await page.getByRole('button',{name:'核对结果',exact:true}).click();await expect(page.getByRole('heading',{name:'远端核对结果'})).toBeVisible();await page.getByRole('button',{name:'关闭',exact:true}).last().click();
 const saved=await page.evaluate(key=>JSON.parse(localStorage.getItem(key)),'apple-workspace-v1:'+profile.id+':'+profile.appId);expect(saved.base[0]).toEqual(actual);expect(saved.draft[0].name).toBe('Newer name');if(newPrice)expect(saved.draft[0].initialPrice.price).toBe('2.99');else expect(saved.draft[0].initialPrice).toBeUndefined();
 await page.getByRole('button',{name:'预览更改'}).click();await expect(page.getByRole('heading',{name:'确认上传到苹果'})).toBeVisible();expect(previewBody.items[0].before).toEqual(actual);expect(previewBody.items[0].after.name).toBe('Newer name');
});
test('Apple historical reconciliation cannot replace an unrelated newer snapshot',async({page})=>{
 const target=auditProduct(),actual={...target,id:'remote',state:'MISSING_METADATA'},newBase={...actual,name:'Remote newer'},draft={...auditProduct(),name:'My current draft'};
 const profile=await auditProfile(page,'conflict',[draft],[newBase]);
 await page.route('**/api/apple/history',r=>r.fulfill({json:{operations:[{file:'history',startedAt:'today',results:[]}]}}));await page.route('**/api/apple/reconcile',r=>r.fulfill({json:{results:[{productId:'coins',status:'verified',before:null,target,actual,canLoadCurrent:true}]}}));
 await page.goto('/apple.html');await page.getByRole('button',{name:'操作记录',exact:true}).click();await page.getByRole('button',{name:'核对结果',exact:true}).click();await expect(page.locator('#dialogBody')).toContainText('本机快照与该历史操作不一致');
 const saved=await page.evaluate(key=>JSON.parse(localStorage.getItem(key)),'apple-workspace-v1:'+profile.id+':'+profile.appId);expect(saved.base).toEqual([newBase]);expect(saved.draft).toEqual([draft]);
});
for(const mixed of [false,true])test('Apple unchanged prices clear pending flags'+(mixed?' alongside a changed product':''),async({page})=>{
 const target={...auditProduct(),initialPrice:{territory:'USA',currency:'USD',price:'0.99'}},actual={...auditProduct(),id:'remote',state:'MISSING_METADATA'},other=auditProduct('other','Other');
 const profile=await auditProfile(page,'noop'+mixed,mixed?[target,other]:[target],[actual]);let writes=0;
 await page.route('**/api/apple/preview',r=>r.fulfill({json:{id:mixed?'plan':undefined,appId:profile.appId,profileId:profile.id,entries:mixed?[{after:other,changes:[{path:'name',after:'Other'}]}]:[],unchanged:[{productId:'coins',status:'verified',before:actual,target,actual}]}}));
 await page.route('**/api/apple/commit',r=>{writes++;return r.fulfill({json:{results:[{productId:'other',status:'verified',target:other,before:null,actual:{...other,id:'remote-other'}}]}})});
 await page.goto('/apple.html');await page.getByRole('button',{name:'预览更改'}).click();await expect(page.locator('#dirtyCount')).toHaveText(mixed?'1':'0');expect(writes).toBe(0);
 if(mixed){await page.getByRole('button',{name:'确认上传 1 个商品',exact:true}).click();await expect(page.locator('#dirtyCount')).toHaveText('0');expect(writes).toBe(1);}else{await expect(page.locator('#status')).toContainText('与远端一致');await expect(page.locator('#modal')).not.toBeVisible();await expect(page.getByRole('button',{name:'预览更改'})).toBeDisabled();}
});
test('Apple export identifies remote products and downloads the returned current base price',async({page})=>{
 const product=auditProduct(),actual={...product,id:'remote',state:'MISSING_METADATA'},profile=await auditProfile(page,'exportprice',[product],[actual]);let request;
 const csv=require('../apple-products').exportCSV([{...product,initialPrice:{territory:'USA',currency:'USD',price:'0.99'}}]);
 await page.route('**/api/apple/export',r=>{request=r.request().postDataJSON();return r.fulfill({json:{csv,warnings:[]}})});
 await page.goto('/apple.html');const downloadEvent=page.waitForEvent('download');await page.locator('#export').click();const download=await downloadEvent;const chunks=[];for await(const chunk of await download.createReadStream())chunks.push(chunk);
 expect(request.remoteProductIds).toEqual(['coins']);expect(request.profileId).toBe(profile.id);expect(require('../apple-products').importCSV(Buffer.concat(chunks).toString('utf8'))[0].initialPrice.price).toBe('0.99');await expect(page.locator('#status')).toContainText('不含其他地区或未来调价计划');
});

test('Apple failed draft validation unlocks the form without enabling immutable fields',async({page})=>{
 const product=auditProduct(),actual={...product,id:'remote',state:'MISSING_METADATA'};await auditProfile(page,'failedsave',[product],[actual]);
 await page.route('**/api/apple/validate',r=>r.fulfill({status:400,json:{error:'Validation unavailable'}}));await page.goto('/apple.html');await page.getByRole('button',{name:'编辑',exact:true}).click();
 await expect(page.locator('#editType')).toBeDisabled();await page.getByRole('button',{name:'保存草稿',exact:true}).click();await expect(page.locator('#dialogError')).toContainText('Validation unavailable');await expect(page.getByRole('button',{name:'保存草稿',exact:true})).toBeEnabled();await expect(page.locator('#editType')).toBeDisabled();await expect(page.getByRole('button',{name:'移除语言',exact:true})).toBeDisabled();await page.keyboard.press('Escape');await expect(page.locator('#modal')).not.toBeVisible();await expect(page.locator('#products')).toContainText('coins');
});
