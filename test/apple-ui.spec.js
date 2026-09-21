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
