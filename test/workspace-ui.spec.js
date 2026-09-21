const {test,expect}=require('@playwright/test');
test('one project manages sibling platforms, preserves drafts and isolates unconfigured projects',async({page,request})=>{
 const session=await(await request.get('/api/session')).json();
 const call=async(path,body={})=>{const r=await request.post('/api/'+path,{headers:{'X-GP-Token':session.token},data:body});expect(r.ok()).toBeTruthy();return r.json();};
 const g=await call('config/save',{name:'星光旅店 · Android',packageName:'com.test.sharedgame'});
 const a=await call('apple/config/save',{name:'星光旅店 · iOS',appId:'987654321',bundleId:'com.test.sharedgame.ios',keyId:'ABCDEFGHIJ',issuerId:'12345678-1234-1234-1234-123456789abc'});
 const projectId='google:'+g.activeId;
 const googleDraft={packageName:g.current.packageName,productId:'coins_100',listings:[{languageCode:'en-US',title:'Android coin pack',description:'Receive coins'}],purchaseOptions:[{purchaseOptionId:'buy',buyOption:{legacyCompatible:true},regionalPricingAndAvailabilityConfigs:[{regionCode:'US',price:{currencyCode:'USD',units:'0',nanos:990000000},availability:'AVAILABLE'}]}]};
 const appleDraft={productId:'coins_100',name:'iOS coin pack',inAppPurchaseType:'CONSUMABLE',reviewNote:'',localizations:[{locale:'zh-Hans',name:'金币礼包',description:'购买后获得100金币'}]};
 await page.addInitScript(({g,a,googleDraft,appleDraft})=>{
  const gkey='gp-workspace-v1:live:'+g.activeId+':'+g.current.packageName,akey='apple-workspace-v1:'+a.activeId+':'+a.current.appId;
  if(!localStorage.getItem(gkey))localStorage.setItem(gkey,JSON.stringify({base:[],draft:[googleDraft],states:{}}));
  if(!localStorage.getItem(akey))localStorage.setItem(akey,JSON.stringify({base:[],draft:[appleDraft]}));
  if(!localStorage.getItem('gp-last-visit-v1'))localStorage.setItem('gp-last-visit-v1',JSON.stringify({mode:'live',projectId:g.activeId}));
 },{g,a,googleDraft,appleDraft});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('/?project='+encodeURIComponent(projectId)+'&live=1');await expect(page.locator('#products')).toContainText('Android coin pack');
 await page.locator('#workspaceManage').click();await page.locator('#workspaceName').fill('星光旅店');await page.locator('#workspaceApple').selectOption(a.activeId);await page.getByRole('button',{name:'保存项目',exact:true}).click();
 await expect(page.locator('#workspaceShell h1')).toHaveText('星光旅店');await expect(page.locator('[data-platform=apple]')).toContainText('已关联应用');
 await page.screenshot({path:'data/project-google-desktop.png',fullPage:true,animations:'disabled'});
 await page.locator('[data-platform=apple]').click();await expect(page.locator('#workspaceShell h1')).toHaveText('星光旅店');await expect(page.locator('#appIdentity')).toContainText('987654321');await expect(page.locator('#products')).toContainText('iOS coin pack');await expect(page.locator('#products')).not.toContainText('Android coin pack');
 await page.locator('[data-edit=coins_100]').click();await page.locator('#editName').fill('iOS edited draft');await page.screenshot({path:'data/project-apple-editor.png',fullPage:true,animations:'disabled'});await page.getByRole('button',{name:'保存草稿',exact:true}).click();
 await expect(page.locator('aside #workspaceProject')).toBeVisible();
 expect(await page.locator('.brand-icon').evaluate(img=>img.complete&&img.naturalWidth>0)).toBeTruthy();
 const rail=await page.locator('aside').boundingBox(),utilities=await page.locator('.sidebar-utilities').boundingBox();expect(utilities.y).toBeGreaterThan(rail.y+rail.height/2);
 await expect(page.locator('#workspaceShell .workspace-heading #workspaceManage')).toBeVisible();
 await expect(page.locator('aside #workspaceManage')).toHaveCount(0);
 await expect(page.locator('aside #settings')).toHaveCount(0);
 await page.locator('#support').click();await expect(page.locator('#dialogTitle')).toHaveText('帮助与诊断');await page.locator('#closeModal').click();
 await page.route('**/api/update/check',r=>r.fulfill({json:{currentVersion:'0.1.17',version:'0.1.17',available:false,supported:true,page:'https://github.com/qiaoxuelin/gp-product-workbench/releases/latest',notes:''}}));
 await page.locator('#update').click();await expect(page.locator('#dialogBody')).toContainText('当前已是最新版本');await page.locator('#closeModal').click();
 await expect(page.locator('#products')).toContainText('iOS edited draft');
 await page.screenshot({path:'data/project-apple-desktop.png',fullPage:true,animations:'disabled'});
 await page.locator('[data-platform=google]').click();await expect(page.locator('#workspaceShell h1')).toHaveText('星光旅店');await expect(page.locator('#products')).toContainText('Android coin pack');await expect(page.locator('#products')).not.toContainText('iOS edited draft');
 await page.locator('[data-platform=apple]').click();await expect(page.locator('#products')).toContainText('iOS edited draft');await page.reload();await expect(page.locator('#products')).toContainText('iOS edited draft');
 await page.locator('#workspaceCreate').click();await page.locator('#workspaceName').fill('未配置的另一个项目');await page.getByRole('button',{name:'保存项目',exact:true}).click();await expect(page.locator('#platformMissing')).toBeVisible();await expect(page.locator('#platformContent')).toBeHidden();
 await page.locator('[data-platform=google]').click();await expect(page.locator('#workspaceShell h1')).toHaveText('未配置的另一个项目');await expect(page.locator('#platformMissing')).toContainText('Google Play');await expect(page.locator('#platformContent')).toBeHidden();
 await page.locator('#workspaceProject').selectOption({label:'星光旅店'});await expect(page.locator('#products')).toContainText('Android coin pack');await page.locator('[data-platform=apple]').click();await expect(page.locator('#products')).toContainText('iOS edited draft');
 for(const width of [900,390]){await page.setViewportSize({width,height:900});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy();await page.screenshot({path:'data/project-apple-'+width+'.png',fullPage:true,animations:'disabled'});}
 expect(errors).toEqual([]);
 const projects=await call('projects');const shared=projects.projects.find(p=>p.id===projectId);expect(shared.googleId).toBe(g.activeId);expect(shared.appleId).toBe(a.activeId);
});

test('peer feature pages keep project and platform context and protect unsaved settings',async({page,request})=>{
 const session=await(await request.get('/api/session')).json();const call=async(path,data)=>{const r=await request.post('/api/'+path,{headers:{'X-GP-Token':session.token},data});expect(r.ok()).toBeTruthy();return r.json();};
 const g=await call('config/save',{name:'功能导航测试',packageName:'com.test.features'}),a=await call('apple/config/save',{name:'功能导航 iOS',appId:'889977',bundleId:'com.test.features.ios',keyId:'ABCDEFGHIJ',issuerId:'12345678-1234-1234-1234-123456789abc'});
 const snapshot=await call('projects',{});const id='google:'+g.activeId;await call('projects/save',{id,name:'功能导航测试',googleId:g.activeId,appleId:a.activeId,revision:snapshot.revision});
 const targets=[];await page.route('**/api/monitor/status',r=>{targets.push(r.request().postDataJSON().profileId);return r.fulfill({json:{enabled:false,tracks:['production'],intervalMinutes:5,snapshot:[],events:[],error:''}});});
 await page.route('**/api/products',r=>r.fulfill({json:{products:[]}}));
 await page.route('**/api/monitor/summary',r=>r.fulfill({json:{projects:[{id:g.activeId,name:'当前应用',unread:2},{id:'other-app',name:'其他应用',unread:9}]}}));
 await page.route('**/api/system/status',r=>r.fulfill({json:{update:{phase:'failed',version:'0.1.17',updatedAt:'test-update',error:'测试更新失败'}}}));
 await page.goto('/?project='+encodeURIComponent(id)+'&live=1&feature=monitor');
 await expect(page.locator('#updateNotice')).toBeVisible();await expect(page.locator('#reviewBadge')).toContainText('2');await expect(page.locator('#reviewMonitor')).toHaveAttribute('title','当前应用：2 条状态变化');
 await expect(page.locator('#reviewMonitor')).toHaveAttribute('aria-pressed','true');await expect(page.locator('#modal')).not.toBeVisible();await expect(page.locator('#platformContent')).toBeHidden();await expect(page.locator('#reviewProject')).toHaveValue(g.activeId);
 await expect(page).toHaveTitle(/Google Play · 审核与发布监控 · PlayBatch/);
 await page.route('**/api/monitor/feishu/status',r=>r.fulfill({json:{enabled:false,states:[],deliveries:[]}}));
 await page.locator('#reviewEnabled').check();await page.locator('#reviewFeishu').click();await page.getByRole('button',{name:'返回审核监控',exact:true}).click();await expect(page.locator('#reviewEnabled')).toBeChecked();
 page.once('dialog',d=>d.dismiss());await page.locator('#finance').click();await expect(page.locator('#reviewMonitor')).toHaveAttribute('aria-pressed','true');await expect(page.locator('#reviewEnabled')).toBeChecked();
 page.once('dialog',d=>d.accept());await page.locator('#finance').click();await expect(page.locator('#featurePanel')).toContainText('开发者账号全部应用');await expect(page).toHaveURL(/feature=billing/);
 await page.screenshot({path:'data/feature-billing-desktop.png',fullPage:true,animations:'disabled'});
 await page.route('**/api/system/status',r=>r.fulfill({status:503,json:{error:'测试更新状态服务不可用'}}));
 await page.locator('[data-platform=apple]').click();await expect(page.locator('#featurePanel')).toContainText('App Store 账单导出尚未接入');await expect(page.locator('#finance')).toHaveAttribute('aria-pressed','true');await page.reload();await expect(page.locator('#workspaceShell h1')).toHaveText('功能导航测试');await expect(page).toHaveURL(/feature=billing/);
 await page.locator('#reviewMonitor').click();await expect(page.locator('#featurePanel')).toContainText('App Store 审核与发布监控尚未接入');await page.locator('[data-platform=google]').click();await expect(page.locator('#reviewProject')).toHaveValue(g.activeId);
 await page.screenshot({path:'data/feature-monitor-desktop.png',fullPage:true,animations:'disabled'});
 await page.setViewportSize({width:390,height:850});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy();await page.screenshot({path:'data/feature-monitor-mobile.png',fullPage:true,animations:'disabled'});
 await page.locator('#catalogFeature').click();await expect(page.locator('#platformContent')).toBeVisible();await expect(page.locator('#featurePanel')).toBeHidden();expect(targets.every(x=>x===g.activeId)).toBeTruthy();
});

test('demo is explicitly entered from help and isolated from a real project',async({page,request})=>{
 const session=await(await request.get('/api/session')).json();const r=await request.post('/api/config/save',{headers:{'X-GP-Token':session.token},data:{name:'真实项目隔离',packageName:'com.test.demoisolation'}});expect(r.ok()).toBeTruthy();const g=await r.json();
 await page.addInitScript(id=>localStorage.setItem('gp-last-visit-v1',JSON.stringify({mode:'demo',projectId:id})),g.activeId);
 await page.route('**/api/products',route=>{if(route.request().postDataJSON().mode==='live')return route.fulfill({json:{products:[]}});return route.continue();});
 await page.goto('/?project='+encodeURIComponent('google:'+g.activeId));await expect(page.locator('#mode')).toBeHidden();await expect(page.locator('#mode')).toHaveValue('live');await expect(page.locator('#workspaceShell h1')).toHaveText('真实项目隔离');
 await page.locator('#create').click();await page.locator('#editId').fill('real_only');await page.getByLabel('商品名称',{exact:true}).fill('Real draft');await page.getByLabel('商品描述',{exact:true}).fill('Keep this draft');await page.getByRole('button',{name:'保存草稿',exact:true}).click();
 await page.locator('#support').click();await page.getByRole('button',{name:'体验演示',exact:true}).click();await expect(page).toHaveURL(/demo=1/);await expect(page.locator('#workspaceShell')).toContainText('独立体验');await expect(page.locator('#featureNavigation')).toBeHidden();await expect(page.locator('#settings')).toBeHidden();await expect(page.locator('#workspaceProject')).toHaveCount(0);await expect(page.locator('#products')).not.toContainText('real_only');await expect(page.locator('#products')).toContainText('coins_100');
 await page.reload();await expect(page.locator('#mode')).toHaveValue('demo');await page.locator('#demoExit').click();await expect(page.locator('#workspaceShell h1')).toHaveText('真实项目隔离');await expect(page.locator('#products')).toContainText('real_only');await expect(page.locator('#mode')).toHaveValue('live');
});
