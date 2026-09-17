const crypto=require('node:crypto');
const {test,expect}=require('@playwright/test');
test.beforeEach(async({context})=>{
  await context.addInitScript(()=>{if(!localStorage.getItem('gp-last-visit-v1'))localStorage.setItem('gp-last-visit-v1',JSON.stringify({mode:'demo',projectId:''}));});
});
test('browser workflow: edit prices, commit demo, copy, create and isolate project drafts',async({page})=>{
  const pair=crypto.generateKeyPairSync('rsa',{modulusLength:2048});
  const fixture={type:'service_account',client_email:'ui-test@example.iam.gserviceaccount.com',private_key:pair.privateKey.export({type:'pkcs8',format:'pem'})};
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('/');
  await expect(page.locator('#total')).toHaveText('3');
  await page.screenshot({path:'data/ui-home.png',fullPage:true});
  await page.getByRole('checkbox',{name:'选择 coins_100',exact:true}).check();
  await page.getByRole('button',{name:'批量改价',exact:true}).click();
  await page.locator('#priceKind').selectOption('percent');
  await page.locator('#priceValue').fill('10');
  await page.locator('#priceRegions [data-clear]').click();
  await page.locator('#priceRegions input[value="US"]').check();
  await page.getByRole('button',{name:'计算并应用到草稿'}).click();
  await expect(page.locator('#dirtyCount')).toHaveText('1');
  await expect(page.locator('tr').filter({has:page.locator('[data-select="coins_100"]')})).toContainText('1.09');
  await expect(page.locator('tr').filter({has:page.locator('[data-select="coins_100"]')})).toContainText('HKD 7');
  await page.locator('#preview').click();
  await expect(page.locator('#dialogBody')).toContainText('USD 0.99');
  await expect(page.locator('#dialogBody')).toContainText('USD 1.09');
  await expect(page.locator('#dialogBody')).not.toContainText('HKD');
  expect(await page.locator('.diff-table td').first().evaluate(el=>el.getBoundingClientRect().width)).toBeGreaterThan(250);
  await page.screenshot({path:'data/ui-preview.png',fullPage:true});
  await page.locator('#confirmWrite').check();
  await page.getByRole('button',{name:'提交演示变更'}).click();
  await expect(page.locator('#dialogTitle')).toHaveText('提交结果');
  await expect(page.locator('#dialogBody')).toContainText('已核对');
  await page.getByRole('button',{name:'关闭',exact:true}).last().click();
  await expect(page.locator('#dirtyCount')).toHaveText('0');
  await page.getByRole('checkbox',{name:'选择 coins_100',exact:true}).check();
  await page.locator('#copy').click();await page.locator('#copyIds').fill('coins_200\ncoins_300');
  await page.getByRole('button',{name:'生成商品草稿'}).click();
  await expect(page.locator('#total')).toHaveText('5');
  await expect(page.locator('#dirtyCount')).toHaveText('2');
  await page.reload();await expect(page.locator('#dirtyCount')).toHaveText('2');
  await page.locator('#newProject').click();
  await expect(page.locator('#dialogTitle')).toHaveText('新建项目');
  await page.locator('#profileName').fill('测试项目 A');
  await page.locator('#profilePackage').fill('com.example.appa');
  await page.locator('#credentialFile').setInputFiles({name:'test-service-account.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(fixture))});
  // Simulate a tab retaining the session token from before a server restart.
  await page.evaluate(()=>{token='expired-before-restart';});
  await page.getByRole('button',{name:/^(保存|创建)并切换到此项目$/}).click();
  await expect(page.locator('#package')).toHaveText('com.example.appa');
  await expect(page.locator('#total')).toHaveText('0');
  await page.locator('#settings').click();
  await expect(page.locator('#credentialStatus')).toContainText(fixture.client_email);
  await expect(page.locator('#credentialJson')).toHaveValue('');
  await page.getByText('如何准备 Google 授权？（完整步骤）',{exact:true}).click();
  await expect(page.locator('.auth-guide')).toContainText('管理商店发布信息');
  await page.getByText('或直接粘贴 JSON 内容',{exact:true}).click();
  fixture.client_email='ui-replacement@example.iam.gserviceaccount.com';
  await page.locator('#credentialJson').fill(JSON.stringify(fixture));
  await page.getByRole('button',{name:/^(保存|创建)并切换到此项目$/}).click();
  await page.locator('#settings').click();
  await expect(page.locator('#credentialStatus')).toContainText(fixture.client_email);
  await expect(page.locator('#credentialJson')).toHaveValue('');
  await page.screenshot({path:'data/ui-credentials.png',fullPage:true});
  await page.getByRole('button',{name:'取消',exact:true}).click();
  await page.locator('#create').click();
  await page.locator('#editId').fill('project_a_only');
  await page.getByRole('textbox',{name:'商品名称',exact:true}).fill('A 项目商品');
  await page.getByRole('textbox',{name:'商品描述',exact:true}).fill('仅用于本地草稿验证');
  await page.getByRole('button',{name:'保存草稿',exact:true}).click();
  await expect(page.locator('#dirtyCount')).toHaveText('1');
  await page.locator('#settings').click();
  await page.locator('#addProject').click();
  await expect(page.locator('#dialogTitle')).toHaveText('新建项目');
  await expect(page.locator('#profileName')).toHaveValue('');
  await expect(page.locator('#profilePackage')).toHaveValue('');
  await expect(page.locator('#credentialStatus')).toContainText('尚未配置');
  await page.locator('#profileName').fill('测试项目 B');
  await page.locator('#profilePackage').fill('com.example.appb');
  await page.getByRole('button',{name:/^(保存|创建)并切换到此项目$/}).click();
  await expect(page.locator('#package')).toHaveText('com.example.appb');
  await expect(page.locator('#project option')).toHaveCount(2);
  await expect(page.locator('#total')).toHaveText('0');
  await page.locator('#project').selectOption({label:'测试项目 A'});
  await expect(page.locator('#total')).toHaveText('1');
  await expect(page.locator('#products')).toContainText('project_a_only');
  await page.reload();
  await expect(page.locator('#mode')).toHaveValue('live');
  await expect(page.locator('#package')).toHaveText('com.example.appa');
  await expect(page.locator('#products')).toContainText('project_a_only');
  await expect(page.locator('#dirtyCount')).toHaveText('1');
  const secondTab=await page.context().newPage();
  await secondTab.goto('/');
  await expect(secondTab.locator('#package')).toHaveText('com.example.appa');
  await expect(secondTab.locator('#products')).toContainText('project_a_only');
  await secondTab.close();
  await page.locator('#mode').selectOption('demo');
  await expect(page.locator('#total')).toHaveText('5');
  await expect(page.locator('#dirtyCount')).toHaveText('2');
  await page.reload();
  await expect(page.locator('#mode')).toHaveValue('demo');
  await expect(page.locator('#total')).toHaveText('5');
  await expect(page.locator('#dirtyCount')).toHaveText('2');
  await page.setViewportSize({width:390,height:844});
  await page.screenshot({path:'data/ui-mobile.png',fullPage:true});
  expect(errors).toEqual([]);
});

test('preview immediately shows progress, then displays disabled API error above the fold without losing drafts',async({page})=>{
  await page.goto('/');
  await expect(page.locator('#total')).toHaveText('3');
  await page.locator('#preview').click();
  await expect(page.locator('#dialogTitle')).toHaveText('操作未完成');
  await expect(page.locator('#dialogBody')).toContainText('没有待提交变化');
  await page.getByRole('button',{name:'关闭',exact:true}).last().click();
  await page.getByRole('checkbox',{name:'选择 coins_100',exact:true}).check();
  await page.locator('#price').click();
  await page.locator('#priceValue').fill('8.99');
  await page.locator('#priceRegions [data-clear]').click();
  await page.locator('#priceRegions input[value="US"]').check();
  await page.getByRole('button',{name:'计算并应用到草稿'}).click();
  let release;
  const gate=new Promise(r=>release=r);
  await page.route('**/api/preview',async route=>{
    await gate;
    await route.fulfill({status:400,contentType:'application/json',body:JSON.stringify({error:'Google 403：Google Play Android Developer API has not been used in project 123456789012 before or it is disabled.'})});
  });
  await page.locator('#preview').click();
  await expect(page.locator('#dialogTitle')).toHaveText('正在生成预览');
  await expect(page.locator('.preview-loading')).toBeVisible();
  release();
  await expect(page.locator('#dialogTitle')).toHaveText('无法生成预览');
  await expect(page.locator('#dialogBody')).toContainText('123456789012');
  await expect(page.getByRole('link',{name:'打开 Google API 设置 ↗'})).toHaveAttribute('href','https://console.cloud.google.com/apis/library/androidpublisher.googleapis.com?project=123456789012');
  await expect(page.locator('#dirtyCount')).toHaveText('1');
  await page.screenshot({path:'data/ui-api-error.png',fullPage:true});
  await page.getByRole('button',{name:'返回编辑',exact:true}).click();
  await expect(page.locator('#preview')).toBeEnabled();
});

test('all-region conversion adds missing countries and preserves option settings until user applies draft',async({page})=>{
  await page.goto('/');
  await expect(page.locator('#total')).toHaveText('3');
  await page.getByRole('checkbox',{name:'选择 coins_100',exact:true}).check();
  await page.route('**/api/convert',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({
    regionVersion:{version:'2025/03'},convertedRegionPrices:{
      US:{regionCode:'US',price:{currencyCode:'USD',units:'2',nanos:0}},
      HK:{regionCode:'HK',price:{currencyCode:'HKD',units:'16',nanos:0}},
      JP:{regionCode:'JP',price:{currencyCode:'JPY',units:'300',nanos:0}}
    }
  })}));
  await page.locator('#price').click();
  await page.locator('#priceKind').selectOption('convert');
  await page.locator('#regionScope').selectOption('all');
  await expect(page.locator('#priceRegions input[type=search]')).toBeDisabled();
  await page.locator('#priceValue').fill('2');
  await page.locator('#priceOption').selectOption('buy');
  await page.getByRole('button',{name:'计算并应用到草稿'}).click();
  await expect(page.locator('#dialogTitle')).toHaveText('Google 换算结果');
  await expect(page.locator('#dialogBody')).toContainText('JP');
  await expect(page.locator('#dialogBody')).toContainText('新增地区');
  await expect(page.locator('#dirtyCount')).toHaveText('0');
  await page.getByRole('button',{name:'应用到草稿',exact:true}).click();
  await expect(page.locator('#dirtyCount')).toHaveText('1');
  await page.locator('[data-edit="coins_100"]').click();
  await expect(page.locator('[data-k="regionCode"]')).toHaveCount(3);
  await expect(page.locator('[data-k="regionCode"]').nth(2)).toHaveValue('JP');
  await expect(page.locator('[data-legacy="0"]')).toBeChecked();
  await page.getByRole('button',{name:'取消',exact:true}).click();
  await page.locator('#preview').click();
  await expect(page.locator('#dialogTitle')).toContainText('提交前预览');
  await expect(page.locator('#dialogBody')).toContainText('JP');
});

test('multilingual template download and upload preview preserves prices and existing languages',async({page})=>{
  await page.goto('/');
  await expect(page.locator('#total')).toHaveText('3');
  await page.getByRole('checkbox',{name:'选择 coins_100',exact:true}).check();
  await page.locator('#languages').click();
  const downloadEvent=page.waitForEvent('download');
  await page.locator('#templateLanguages input[type=search]').fill('zh-TW');
  await page.locator('#templateLanguages input[value="zh-TW"]').check();
  await page.locator('#templateLanguages input[type=search]').fill('日语');
  await page.locator('#templateLanguages input[value="ja-JP"]').check();
  await expect(page.locator('#templateLanguages .choice-summary')).toContainText('已选 2 项');
  await page.locator('#templateLanguages input[type=search]').fill('');
  await expect(page.locator('#templateLanguages input[value="zh-TW"]')).toBeChecked();
  await page.screenshot({path:'data/ui-language-options.png',fullPage:true});
  await page.locator('#downloadLanguages').click();
  const download=await downloadEvent;
  expect(download.suggestedFilename()).toBe('gp-multilingual-template.xlsx');
  const stream=await download.createReadStream();const chunks=[];for await(const chunk of stream)chunks.push(chunk);
  const workbook=require('../vendor/xlsx.full.min.js').read(Buffer.concat(chunks),{type:'buffer'});expect(workbook.SheetNames).toEqual(expect.arrayContaining(['zh-TW','ja-JP','zh-CN','en-US']));
  await page.locator('#templateLanguages [data-clear]').click();
  await expect(page.locator('#templateLanguages .choice-summary')).toHaveText('已选 0 项');
  await page.locator('#languageFile').setInputFiles({name:'languages.csv',mimeType:'text/csv',buffer:Buffer.from('productId,languageCode,title,description\r\ncoins_100,zh-TW,100金幣,購買後獲得100金幣')});
  await page.getByRole('button',{name:'检查并预览导入'}).click();
  await expect(page.locator('#dialogTitle')).toContainText('多语言导入预览');
  await expect(page.locator('#dialogBody')).toContainText('新增语言');
  await expect(page.locator('#dirtyCount')).toHaveText('0');
  await page.getByRole('button',{name:'应用到草稿',exact:true}).click();
  await page.locator('[data-edit="coins_100"]').click();
  await expect(page.locator('[data-k="languageCode"]')).toHaveCount(3);
  await expect(page.locator('[data-k="languageCode"]').last()).toHaveValue('zh-TW');
  await expect(page.locator('[data-k="price"]')).toHaveCount(2);
  await page.getByRole('button',{name:'取消',exact:true}).click();
  await page.locator('#preview').click();
  await expect(page.locator('#dialogTitle')).toContainText('提交前预览');
  await expect(page.locator('#dialogBody')).toContainText('zh-TW');
  await expect(page.locator('.diff-table')).not.toContainText('购买选项');
});

test('selection controls save language and regional price changes',async({page})=>{
  await page.goto('/');await expect(page.locator('#total')).toHaveText('3');
  await page.locator('[data-edit="coins_100"]').click();
  await page.locator('#addLocale').click();
  await page.locator('select[data-k="languageCode"]').last().selectOption('ja-JP');
  await page.locator('[data-k="title"]').last().fill('100コイン');
  await page.locator('[data-k="description"]').last().fill('100コインを獲得');
  await page.locator('[data-add-r="0"]').click();
  await page.locator('select[data-k="regionCode"]').last().selectOption('JP');
  await page.locator('select[data-k="currencyCode"]').last().selectOption('JPY');
  await page.locator('[data-k="price"]').last().fill('150');
  await page.getByRole('button',{name:'保存草稿',exact:true}).click();
  await expect(page.locator('#modal')).not.toBeVisible();
  await page.locator('[data-edit="coins_100"]').click();
  await expect(page.locator('select[data-k="languageCode"]').last()).toHaveValue('ja-JP');
  await expect(page.locator('select[data-k="regionCode"]').last()).toHaveValue('JP');
  await expect(page.locator('select[data-k="currencyCode"]').last()).toHaveValue('JPY');
  await expect(page.locator('[data-k="price"]').last()).toHaveValue('150');
  await page.screenshot({path:'data/ui-edit-options.png',fullPage:true});
});

test('catalog filters retain explicit selection scope and region search preserves hidden values',async({page})=>{
  await page.goto('/');await expect(page.locator('#total')).toHaveText('3');
  await expect(page.locator('#price')).toBeDisabled();
  await page.locator('[data-select="coins_100"]').check();
  await page.locator('#search').fill('REMOVE_ADS');
  await expect(page.locator('#resultCount')).toHaveText('显示 1 / 3 个商品');
  await expect(page.locator('#selectionHint')).toContainText('筛选外 1 个');
  await page.locator('#selectAll').check();
  await expect(page.locator('#selectedCount')).toHaveText('2');
  await expect(page.locator('#copy')).toBeDisabled();
  await page.locator('#resetFilters').click();
  await page.locator('[data-filter="selected"]').click();
  await expect(page.locator('#products tr')).toHaveCount(2);
  await page.locator('#clearSelection').click();
  await expect(page.locator('#empty')).toContainText('没有匹配的商品');
  await page.locator('#resetFilters').click();
  await page.locator('[data-edit="coins_100"]').click();
  await page.locator('[data-region-search="0"]').fill('美元');
  await expect(page.locator('.region-row:visible')).toHaveCount(1);
  await page.locator('[data-k="price"]').first().fill('1.99');
  await page.getByRole('button',{name:'保存草稿',exact:true}).click();
  await page.locator('[data-filter="dirty"]').click();
  await expect(page.locator('#products tr')).toHaveCount(1);
  await expect(page.locator('#products')).toContainText('HKD 7');
  await page.setViewportSize({width:390,height:844});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:'data/ui-polished-mobile.png',fullPage:true});
});

test('single product template preserves unsaved edits and returns to editor before saving',async({page})=>{
  await page.goto('/');await expect(page.locator('#total')).toHaveText('3');
  await page.locator('[data-select="coins_550"]').check();
  await page.locator('[data-edit="coins_100"]').click();
  await page.locator('[data-k="price"]').first().fill('3.99');
  await page.locator('#editLanguages').click();
  await expect(page.locator('#dialogBody')).toContainText('当前编辑商品 coins_100');
  const downloadEvent=page.waitForEvent('download');
  await page.locator('#downloadLanguages').click();
  const download=await downloadEvent;const stream=await download.createReadStream();const chunks=[];
  for await(const chunk of stream)chunks.push(chunk);
  const parsed=require('../listings-workbook').readWorkbook(Buffer.concat(chunks));expect(parsed.rows.every(r=>r.productId==='coins_100')).toBeTruthy();
  await page.keyboard.press('Escape');
  await expect(page.locator('#editId')).toHaveValue('coins_100');
  await expect(page.locator('[data-k="price"]').first()).toHaveValue('3.99');
  await page.locator('#editLanguages').click();
  const singleWorkbook=require('../listings-workbook').exportWorkbook([{productId:'coins_100',listings:[{languageCode:'ja-JP',title:'100コイン',description:'100コインを獲得'}]}]);
  await page.locator('#languageFile').setInputFiles({name:'single.xlsx',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',buffer:singleWorkbook});
  await expect(page.locator('#languageEncodingPreview')).toContainText('ja-JP：1 条');
  await expect(page.locator('#languageEncoding')).toBeHidden();
  await page.getByRole('button',{name:'检查并预览导入'}).click();
  await expect(page.locator('#dialogTitle')).toContainText('多语言导入预览');
  await page.getByRole('button',{name:'应用到商品表单'}).click();
  await expect(page.locator('[data-k="languageCode"]').last()).toHaveValue('ja-JP');
  await expect(page.locator('[data-k="price"]').first()).toHaveValue('3.99');
  await expect(page.locator('#dirtyCount')).toHaveText('0');
  await page.getByRole('button',{name:'保存草稿',exact:true}).click();
  await expect(page.locator('#dirtyCount')).toHaveText('1');
  await page.locator('[data-edit="coins_550"]').click();
  await expect(page.locator('[data-k="languageCode"]')).toHaveCount(2);
});

test('legacy Excel CSV decodes GBK and UTF16 without losing Chinese text',async({page})=>{
  await page.goto('/');await expect(page.locator('#total')).toHaveText('3');
  await page.locator('[data-select="coins_100"]').check();await page.locator('#languages').click();
  const gbk=Buffer.concat([Buffer.from('productId,languageCode,title,description\ncoins_100,zh-CN,'),Buffer.from([0xd6,0xd0,0xce,0xc4]),Buffer.from(','),Buffer.from([0xc3,0xe8,0xca,0xf6])]);
  await page.locator('#languageFile').setInputFiles({name:'gbk.csv',mimeType:'text/csv',buffer:gbk});
  await page.getByRole('button',{name:'检查并预览导入'}).click();
  await expect(page.locator('#dialogBody')).toContainText('中文');
  await expect(page.locator('#dialogBody')).toContainText('描述');
  await page.getByRole('button',{name:'取消',exact:true}).click();
  await page.locator('#languages').click();
  const utf16=Buffer.concat([Buffer.from([255,254]),Buffer.from('productId,languageCode,title,description\ncoins_100,ja-JP,日本語,説明','utf16le')]);
  await page.locator('#languageFile').setInputFiles({name:'utf16.csv',mimeType:'text/csv',buffer:utf16});
  await page.getByRole('button',{name:'检查并预览导入'}).click();
  await expect(page.locator('#dialogBody')).toContainText('日本語');
  await page.getByRole('button',{name:'取消',exact:true}).click();
  await page.locator('#languages').click();
  await page.locator('#languageFile').setInputFiles({name:'damaged.csv',mimeType:'text/csv',buffer:Buffer.from('productId,languageCode,title,description\ncoins_100,zh-CN,\uFFFD,损坏')});
  await page.getByRole('button',{name:'检查并预览导入'}).click();
  await expect(page.locator('[role=alert]')).toContainText('损坏字符');
});
test('new product can be created and activated in one confirmed submission',async({page})=>{
  await page.goto('/');await expect(page.locator('#total')).toHaveText('3');
  await page.locator('[data-select="coins_100"]').check();await page.locator('#copy').click();
  await page.locator('#copyIds').fill('new_active');
  await page.getByRole('button',{name:'生成商品草稿'}).click();
  await page.locator('#preview').click();
  await expect(page.locator('#dialogTitle')).toHaveText('新商品提交后的状态');
  await page.getByRole('button',{name:'创建并启用',exact:true}).click();
  await expect(page.locator('#dialogTitle')).toContainText('提交前预览');
  await expect(page.locator('#dialogBody')).toContainText('ACTIVE');
  await page.locator('#confirmWrite').check();
  await page.getByRole('button',{name:'提交演示变更'}).click();
  await expect(page.locator('#dialogBody')).toContainText('buy 已启用');
  await page.getByRole('button',{name:'关闭',exact:true}).last().click();
  await expect(page.locator('tr').filter({has:page.locator('[data-select="new_active"]')})).toContainText('已启用');
});

test('status filters combine with search and distinguish draft active and inactive products',async({page})=>{
  await page.goto('/');await expect(page.locator('#products')).toContainText('coins_100');
  await page.evaluate(()=>{
    draft=['coins_100','coins_550','remove_ads'].map(id=>draft.find(p=>p.productId===id));
    draft[0].purchaseOptions[0].state='DRAFT';
    draft[1].purchaseOptions[0].state='INACTIVE';
    draft[2].purchaseOptions[0].state='ACTIVE';
    render();
  });
  await page.locator('#productStateFilter').selectOption('DRAFT');
  await expect(page.locator('#products tr')).toHaveCount(1);
  await expect(page.locator('#products')).toContainText('coins_100');
  await page.locator('#productStateFilter').selectOption('INACTIVE');
  await expect(page.locator('#products')).toContainText('coins_550');
  await page.locator('#productStateFilter').selectOption('ACTIVE');
  await expect(page.locator('#products tr')).toHaveCount(1);
  await expect(page.locator('#products')).toContainText('remove_ads');
  await page.locator('#search').fill('coins');
  await expect(page.locator('#empty')).toBeVisible();
  await page.locator('#resetFilters').click();
  await expect(page.locator('#products tr')).toHaveCount(3);
});

test('file preview refreshes encoding and reports malformed CSV before import',async({page})=>{
  await page.goto('/');await expect(page.locator('#products')).toContainText('coins_100');
  await page.locator('#languages').click();
  const bytes=Buffer.concat([Buffer.from('productId,languageCode,title,description\ncoins_100,zh-CN,'),Buffer.from([0xd6,0xd0,0xce,0xc4]),Buffer.from(',text')]);
  await page.locator('#languageFile').setInputFiles({name:'preview.csv',mimeType:'text/csv',buffer:bytes});
  await expect(page.locator('#languageEncodingPreview')).toContainText('中文');
  await expect(page.locator('#languageEncodingPreview')).toContainText('CSV 格式有效');
  await page.locator('#languageEncoding').selectOption('utf-8');
  await expect(page.locator('#languageEncodingPreview')).toContainText('无法按 utf-8 解码');
  await page.locator('#languageEncoding').selectOption('gb18030');
  await expect(page.locator('#languageEncodingPreview')).toContainText('中文');
  await page.locator('#languageFile').setInputFiles({name:'bad.csv',mimeType:'text/csv',buffer:Buffer.from('productId,languageCode,title,description\ncoins_100,en-US,missing-description')});
  await expect(page.locator('#languageEncodingPreview')).toContainText('第 2 行列数不符');
  await page.screenshot({path:'data/ui-import-preview.png',fullPage:true});
  await page.getByRole('button',{name:'取消',exact:true}).click();
  await page.locator('#about').click();
  await expect(page.locator('#dialogTitle')).toHaveText('关于 PlayBatch');
  await expect(page.locator('#dialogBody')).toContainText('当前版本');
});

test('unfinished result requires remote review and a new confirmation before retry',async({page})=>{
  await page.goto('/');await expect(page.locator('#products')).toContainText('coins_100');
  const before=await page.evaluate(()=>structuredClone(base.find(p=>p.productId==='coins_100')));
  await page.locator('[data-select="coins_100"]').check();await page.locator('#price').click();
  await page.locator('#priceValue').fill('2.99');await page.getByRole('button',{name:'计算并应用到草稿'}).click();
  await expect(page.locator('#dirtyCount')).toHaveText('1');
  const after=await page.evaluate(()=>structuredClone(draft.find(p=>p.productId==='coins_100')));
  let writes=0,reads=0;
  await page.route('**/api/commit',route=>{writes++;return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({logFile:'operation-test.json',results:[{productId:'coins_100',status:'uncertain',message:'连接中断，请核对',steps:{check:'success',configuration:'uncertain',state:'skipped',readback:'pending'}}]})});});
  await page.route('**/api/recover',route=>{reads++;return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({entries:[{before,after,states:{},reason:'远端仍与原始版本一致'}],resolved:[],blocked:[]})});});
  await page.locator('#preview').click();await page.locator('#confirmWrite').check();
  await page.getByRole('button',{name:'提交演示变更'}).click();
  await expect(page.locator('.result-steps')).toContainText('创建 / 更新 · 待核对');
  await page.getByRole('button',{name:'核对未完成项',exact:true}).click();
  await expect(page.locator('#dialogTitle')).toHaveText('未完成项核对结果');
  expect(writes).toBe(1);expect(reads).toBe(1);
  await page.getByRole('button',{name:'应用核对结果并预览'}).click();

  await expect(page.locator('#dialogTitle')).toContainText('提交前预览');
  await expect(page.locator('#confirmWrite')).not.toBeChecked();expect(writes).toBe(1);
});

test('monthly finance UI saves account report address, downloads original bytes and invalidates changed month',async({page})=>{
  const profile={id:'finance-project',name:'财务测试项目',packageName:'com.example.finance',hasCredential:true,credentialEmail:'finance@example.iam.gserviceaccount.com',financialBucket:''};
  await page.route('**/api/config',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({profiles:[profile],activeId:profile.id,current:profile})}));
  await page.route('**/api/finance/config',route=>{
    const b=route.request().postDataJSON();expect(b.profileId).toBe(profile.id);expect(b.mode).toBe('live');
    profile.financialBucket=b.bucket.replace(/^gs:\/\//,'').split('/')[0];
    return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({profiles:[profile],activeId:profile.id,current:profile})});
  });
  await page.route('**/api/finance/list',route=>{
    expect(route.request().postDataJSON().month).toBe('2026-08');
    return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({month:'2026-08',bucket:profile.financialBucket,scope:'developer-account',files:[{id:'report-ticket',name:'earnings_202608.zip',size:'12',generation:'123',updated:'2026-09-05T00:00:00Z'}]})});
  });
  const original=Buffer.from('original zip');
  await page.route('**/api/finance/download',route=>{
    expect(route.request().postDataJSON().reportId).toBe('report-ticket');
    return route.fulfill({status:200,contentType:'application/zip',body:original});
  });
  await page.goto('/');await expect(page.locator('#products')).toContainText('coins_100');
  await page.locator('#finance').click();
  await expect(page.locator('#dialogBody')).toContainText('当前为演示模式');
  await page.getByRole('button',{name:'关闭',exact:true}).last().click();
  await page.locator('#mode').selectOption('live');
  await page.locator('#finance').click();
  await expect(page.locator('#dialogBody')).toContainText('开发者账号全部应用');
  await page.locator('#financeBucket').fill('gs://pubsite_prod_rev_finance/earnings/');
  await page.locator('#financeYear').selectOption('2026');await page.locator('#financeMonth').selectOption('08');
  await page.locator('#financeList').click();
  await expect(page.locator('#financeFiles')).toContainText('earnings_202608.zip');
  await page.screenshot({path:'data/ui-finance.png',fullPage:true});
  const event=page.waitForEvent('download');await page.locator('#financeDownload0').click();
  const file=await event;expect(file.suggestedFilename()).toBe('earnings_202608.zip');
  const chunks=[];for await(const chunk of await file.createReadStream())chunks.push(chunk);
  expect(Buffer.concat(chunks)).toEqual(original);
  await page.locator('#financeMonth').selectOption('07');
  await expect(page.locator('#financeFiles')).toContainText('重新读取');
  await expect(page.locator('#financeDownload0')).toHaveCount(0);
  await page.getByRole('button',{name:'关闭',exact:true}).last().click();
  await page.locator('#finance').click();
  await expect(page.locator('#financeBucket')).toHaveValue('pubsite_prod_rev_finance');
});

test('update dialog distinguishes source mode and preserves draft when installer fails',async({page})=>{
  await page.route('**/api/update/check',route=>route.fulfill({json:{currentVersion:'0.1.7',version:'0.2.0',available:true,supported:false,page:'https://github.com/qiaoxuelin/gp-product-workbench/releases/tag/v0.2.0',notes:'<script>alert(1)</script>'}}));
  await page.goto('/');await expect(page.locator('#products')).toContainText('coins_100');
  await page.locator('#update').click();await expect(page.locator('#dialogBody')).toContainText('不支持自动安装');
  await expect(page.getByRole('button',{name:'更新并重启',exact:true})).toHaveCount(0);
  await page.locator('#closeModal').click();
  await page.route('**/api/update/check',route=>route.fulfill({json:{currentVersion:'0.1.7',version:'0.2.0',available:true,supported:true,page:'https://github.com/qiaoxuelin/gp-product-workbench/releases/tag/v0.2.0',notes:'test release'}}));
  let requested;
  await page.route('**/api/update/start',route=>{requested=route.request().postDataJSON();return route.fulfill({json:{started:true}});});
  await page.route('**/api/update/status',route=>route.fulfill({json:{phase:'failed',message:'SHA256 校验失败'}}));
  await page.locator('#update').click();await page.getByRole('button',{name:'更新并重启',exact:true}).click();
  await expect(page.locator('#dialogTitle')).toHaveText('更新未完成');
  expect(requested.version).toBe('0.2.0');await expect(page.locator('#dialogBody')).toContainText('SHA256 校验失败');
  expect(await page.evaluate(()=>Object.keys(localStorage).some(k=>k.startsWith('gp-workspace-v1:')))).toBeTruthy();
  await page.locator('#closeModal').click();await expect(page.locator('#refresh')).toBeEnabled();
});

test('Excel multilingual sheets preview Unicode and errors by sheet before applying',async({page})=>{
  await page.goto('/');await expect(page.locator('#products')).toContainText('coins_100');await page.locator('[data-select="coins_100"]').check();await page.locator('#languages').click();
  const W=require('../listings-workbook'),X=require('../vendor/xlsx.full.min.js');
  const bytes=W.exportWorkbook([{productId:'coins_100',listings:[{languageCode:'zh-TW',title:'金幣',description:'繁體內容'},{languageCode:'ja-JP',title:'コイン',description:'日本語の説明'}]}],['ko-KR']);
  await page.locator('#languageFile').setInputFiles({name:'translations.xlsx',mimeType:W.MIME,buffer:bytes});
  await expect(page.locator('#languageEncodingPreview')).toContainText('ko-KR：0 条，跳过空白 1 行');
  await expect(page.locator('#languageEncodingPreview')).toContainText('繁體內容');
  await page.getByRole('button',{name:'检查并预览导入'}).click();
  await expect(page.locator('#dialogBody')).toContainText('日本語の説明');
  await page.getByRole('button',{name:'应用到草稿',exact:true}).click();
  await page.locator('#languages').click();
  const wb=X.read(bytes,{type:'buffer'});wb.Sheets['ja-JP'].C2={t:'s',v:''};
  await page.locator('#languageFile').setInputFiles({name:'incomplete.xlsx',mimeType:W.MIME,buffer:Buffer.from(X.write(wb,{type:'buffer',bookType:'xlsx',compression:true}))});
  await page.getByRole('button',{name:'检查并预览导入'}).click();
  await expect(page.locator('#modalError')).toContainText('页签 ja-JP 第 2 行');
});

test('old backend update endpoint gives restart instructions instead of indefinite loading',async({page})=>{
  await page.route('**/api/update/check',route=>route.fulfill({status:400,json:{error:'未知接口'}}));
  await page.goto('/');await expect(page.locator('#products')).toContainText('coins_100');
  await page.locator('#update').click();
  await expect(page.locator('#dialogTitle')).toHaveText('检查更新未完成');
  await expect(page.locator('#dialogBody')).toContainText('停止工具.cmd');
  await expect(page.locator('#dialogBody')).toContainText('启动工具.cmd');
  await expect(page.locator('#dialogBody')).not.toContainText('正在读取');
  await expect(page.getByRole('button',{name:'重试',exact:true})).toBeEnabled();
});

test('discard and reread removes persisted drafts even when storage quota prevents saving snapshots',async({page})=>{
  await page.goto('/');await expect(page.locator('#products')).toContainText('coins_100');
  await page.locator('[data-edit="coins_100"]').click();await page.locator('[data-k="price"]').first().fill('8.88');await page.getByRole('button',{name:'保存草稿',exact:true}).click();
  await expect(page.locator('#dirtyCount')).toHaveText('1');
  await page.evaluate(()=>{const original=Storage.prototype.setItem;Storage.prototype.setItem=function(k,v){if(k.startsWith('gp-workspace-v1:'))throw new DOMException('Quota exceeded','QuotaExceededError');return original.call(this,k,v);};});
  await page.locator('#refresh').click();await page.getByRole('button',{name:'放弃草稿并重新读取',exact:true}).click();
  await expect(page.locator('#dirtyCount')).toHaveText('0');await expect(page.locator('#status')).toContainText('已读取');
  expect(await page.evaluate(()=>Object.keys(localStorage).filter(k=>k.startsWith('gp-workspace-v1:')).length)).toBe(0);
  await page.reload();await expect(page.locator('#products')).toContainText('coins_100');await expect(page.locator('#dirtyCount')).toHaveText('0');
});

test('selected draft discard updates badge and stays discarded after reload',async({page})=>{
  await page.goto('/');await expect(page.locator('#products')).toContainText('coins_100');
  await page.locator('[data-edit="coins_100"]').click();await page.locator('[data-k="price"]').first().fill('9.99');await page.getByRole('button',{name:'保存草稿',exact:true}).click();
  await page.locator('[data-select="coins_100"]').check();await page.locator('#discard').click();await page.getByRole('button',{name:'撤销草稿',exact:true}).click();
  await expect(page.locator('#pendingBadge')).toHaveText('0');await expect(page.locator('tr').filter({has:page.locator('[data-select="coins_100"]')})).toContainText('无待提交修改');
  await page.reload();await expect(page.locator('#products')).toContainText('coins_100');await expect(page.locator('#pendingBadge')).toHaveText('0');
});
test('review monitor config shows approval separate from publication and retains last successful result on error',async({page})=>{
  const p={id:'review',name:'Review App',packageName:'com.example.review',hasCredential:true};let request;
  await page.route('**/api/config',route=>route.fulfill({json:{profiles:[p],activeId:p.id,current:p}}));
  await page.addInitScript(()=>localStorage.setItem('gp-last-visit-v1',JSON.stringify({mode:'live',projectId:'review'})));
  await page.route('**/api/products',route=>route.fulfill({json:{products:[]}}));
  const state={enabled:true,tracks:['production'],intervalMinutes:5,snapshot:[{track:'production',name:'1.0',versionCodes:['10'],state:'RELEASE_LIFECYCLE_STATE_APPROVED_NOT_PUBLISHED'}],events:[],lastCheck:'2026-09-17T00:00:00Z',unread:0,error:''};
  await page.route('**/api/monitor/status',route=>route.fulfill({json:state}));
  await page.route('**/api/monitor/config',route=>{request=route.request().postDataJSON();return route.fulfill({json:state});});
  await page.route('**/api/monitor/check',route=>route.fulfill({json:{...state,error:'Google 403：权限不足'}}));
  await page.goto('/');await page.locator('#reviewMonitor').click();
  await expect(page.locator('#reviewResults')).toContainText('通过待发布');
  await page.locator('#reviewCheck').click();await expect(page.locator('#reviewResults')).toContainText('下方保留上次成功结果');
  expect(request.profileId).toBe('review');expect(request.tracks).toEqual(['production']);
  await expect(page.locator('#reviewResults')).toContainText('通过待发布');
});

test('Feishu notification settings hide secrets and only send a test on explicit click',async({page})=>{
  const p={id:'notify',name:'Notify App',packageName:'com.example.notify',hasCredential:true};
  await page.route('**/api/config',route=>route.fulfill({json:{profiles:[p],activeId:p.id,current:p}}));
  await page.addInitScript(()=>localStorage.setItem('gp-last-visit-v1',JSON.stringify({mode:'live',projectId:'notify'})));
  await page.route('**/api/products',route=>route.fulfill({json:{products:[]}}));
  await page.route('**/api/monitor/status',route=>route.fulfill({json:{enabled:true,tracks:['production'],intervalMinutes:5,snapshot:[],events:[],lastCheck:null,error:''}}));
  const state={enabled:false,states:['RELEASE_LIFECYCLE_STATE_APPROVED_NOT_PUBLISHED','RELEASE_LIFECYCLE_STATE_PUBLISHED'],hasWebhook:false,hasSecret:false,deliveries:[]};let tests=0,payload;
  await page.route('**/api/monitor/feishu/status',route=>route.fulfill({json:state}));
  await page.route('**/api/monitor/feishu/config',route=>{payload=route.request().postDataJSON();return route.fulfill({json:{...state,hasWebhook:true,enabled:true}});});
  await page.route('**/api/monitor/feishu/test',route=>{tests++;return route.fulfill({json:{...state,deliveries:[{id:'test',status:'sent',kind:'test',text:'PlayBatch 测试通知',sentAt:'2026-09-17T00:00:00Z'}]}});});
  await page.goto('/');await page.locator('#reviewMonitor').click();await page.locator('#reviewFeishu').click();
  await page.locator('#feishuEnabled').check();await page.locator('#feishuWebhook').fill('https://open.feishu.cn/open-apis/bot/v2/hook/11111111-2222-3333-4444-555555555555');
  await page.locator('#feishuSave').click();await expect(page.locator('#feishuWebhook')).toHaveValue('');expect(tests).toBe(0);expect(payload.profileId).toBe('notify');
  await page.locator('#feishuTest').click();await expect(page.locator('#feishuResults')).toContainText('已发送');expect(tests).toBe(1);
});

test('review project selection is independent, persisted and used by Feishu',async({page})=>{
  const a={id:'a',name:'Product A',packageName:'com.example.a'},b={id:'b',name:'Review B',packageName:'com.example.b'};
  const requests=[];
  await page.route('**/api/config',route=>route.fulfill({json:{profiles:[a,b],activeId:'a',current:a}}));
  await page.route('**/api/monitor/**',route=>{
    const body=route.request().postDataJSON();requests.push({url:route.request().url(),...body});
    const json=route.request().url().endsWith('/summary')?{projects:[]}:route.request().url().includes('/feishu/')?{enabled:false,states:[],deliveries:[]}:{enabled:false,tracks:['production'],intervalMinutes:5,snapshot:[],events:[]};
    return route.fulfill({json});
  });
  await page.goto('/');await expect(page.locator('#products')).toContainText('coins_100');
  await page.locator('[data-edit="coins_100"]').click();await page.locator('[data-k="price"]').first().fill('9.99');await page.getByRole('button',{name:'保存草稿',exact:true}).click();
  await expect(page.locator('#pendingBadge')).toHaveText('1');
  await page.locator('#reviewMonitor').click();await expect(page.locator('#reviewProject')).toHaveValue('a');
  await page.locator('#reviewProject').selectOption('b');await expect(page.locator('#modal')).toContainText('应用审核监控 · Review B');
  await page.locator('#reviewEnabled').check();
  page.once('dialog',dialog=>dialog.dismiss());
  await page.locator('#reviewProject').selectOption('a');await expect(page.locator('#reviewProject')).toHaveValue('b');await expect(page.locator('#reviewEnabled')).toBeChecked();
  await page.locator('#reviewSave').click();await expect(page.locator('#status')).toContainText('监控已关闭');
  expect(requests.find(r=>r.url.endsWith('/config')).profileId).toBe('b');
  await page.locator('#reviewFeishu').click();await expect(page.locator('#modal')).toContainText('飞书群通知 · Review B');
  expect(requests.find(r=>r.url.endsWith('/feishu/status')).profileId).toBe('b');
  await page.locator('#closeModal').click();await expect(page.locator('#mode')).toHaveValue('demo');await expect(page.locator('#project')).toHaveValue('a');await expect(page.locator('#pendingBadge')).toHaveText('1');
  await page.reload();await page.locator('#reviewMonitor').click();await expect(page.locator('#reviewProject')).toHaveValue('b');
  expect(requests.filter(r=>!r.url.endsWith('/summary')).every(r=>r.mode==='live')).toBeTruthy();
});

for(const previewFirst of [false,true])test('new draft discard removes product and survives reload '+(previewFirst?'after activation preview':'before preview'),async({page})=>{
  let commits=0;page.on('request',r=>{if(r.url().endsWith('/api/commit'))commits++;});
  await page.goto('/');await expect(page.locator('#products')).toContainText('coins_100');
  const total=Number(await page.locator('#total').textContent());
  await page.locator('#create').click();await page.locator('#editId').fill('discard_new');
  await page.getByLabel('商品名称',{exact:true}).fill('New draft');await page.getByLabel('商品描述',{exact:true}).fill('Discard test');
  await page.getByRole('button',{name:'保存草稿',exact:true}).click();
  await expect(page.locator('#pendingBadge')).toHaveText('1');
  if(previewFirst){await page.locator('#preview').click();await page.getByRole('button',{name:'创建并启用',exact:true}).click();await expect(page.locator('#dialogTitle')).toContainText('提交前预览');await page.locator('#closeModal').click();}
  await page.locator('#discard').click();await page.getByRole('button',{name:'取消',exact:true}).click();await expect(page.locator('[data-select="discard_new"]')).toHaveCount(1);
  await page.locator('#discard').click();await page.getByRole('button',{name:'撤销草稿',exact:true}).click();
  await expect(page.locator('[data-select="discard_new"]')).toHaveCount(0);await expect(page.locator('#pendingBadge')).toHaveText('0');await expect(page.locator('#total')).toHaveText(String(total));
  expect(await page.evaluate(()=>Object.keys(localStorage).filter(k=>k.startsWith('gp-workspace-v1:')).length)).toBe(0);
  await page.reload();await expect(page.locator('#products')).toContainText('coins_100');await expect(page.locator('[data-select="discard_new"]')).toHaveCount(0);await expect(page.locator('#pendingBadge')).toHaveText('0');expect(commits).toBe(0);
});

test('new draft discard preserves other drafts and rolls back when storage fails',async({page})=>{
  await page.goto('/');await expect(page.locator('#products')).toContainText('coins_100');
  await page.locator('[data-edit="coins_100"]').click();await page.locator('[data-k="price"]').first().fill('8.76');await page.getByRole('button',{name:'保存草稿',exact:true}).click();
  await page.locator('#copy').click();await page.locator('#copyIds').fill('discard_copy\nkeep_copy');await page.getByRole('button',{name:'生成商品草稿'}).click();
  await page.locator('#clearSelection').click();await page.locator('[data-select="discard_copy"]').check();await expect(page.locator('#pendingBadge')).toHaveText('3');
  const before=await page.evaluate(()=>Object.fromEntries(Object.keys(localStorage).filter(k=>k.startsWith('gp-workspace-v1:')).map(k=>[k,localStorage[k]])));
  await page.evaluate(()=>{window.savedSetItem=Storage.prototype.setItem;Storage.prototype.setItem=function(k,v){if(k.startsWith('gp-workspace-v1:'))throw new DOMException('quota','QuotaExceededError');return window.savedSetItem.call(this,k,v);};});
  await page.locator('#discard').click();await page.getByRole('button',{name:'撤销草稿',exact:true}).click();
  await expect(page.locator('#dialogBody')).toContainText('无法保存撤销结果');await expect(page.locator('[data-select="discard_copy"]')).toHaveCount(1);
  expect(await page.evaluate(()=>Object.fromEntries(Object.keys(localStorage).filter(k=>k.startsWith('gp-workspace-v1:')).map(k=>[k,localStorage[k]])))).toEqual(before);
  await page.evaluate(()=>Storage.prototype.setItem=window.savedSetItem);
  await page.getByRole('button',{name:'撤销草稿',exact:true}).click();await expect(page.locator('#pendingBadge')).toHaveText('2');
  await page.reload();await expect(page.locator('[data-select="discard_copy"]')).toHaveCount(0);await expect(page.locator('[data-select="keep_copy"]')).toHaveCount(1);await expect(page.locator('#pendingBadge')).toHaveText('2');
  await page.locator('[data-edit="coins_100"]').click();await expect(page.locator('[data-k="price"]').first()).toHaveValue('8.76');await page.locator('#closeModal').click();
  await page.locator('#refresh').click();await page.getByRole('button',{name:'放弃草稿并重新读取',exact:true}).click();await expect(page.locator('#pendingBadge')).toHaveText('0');
  await page.reload();await expect(page.locator('#products')).toContainText('coins_100');await expect(page.locator('[data-select="keep_copy"]')).toHaveCount(0);await expect(page.locator('#pendingBadge')).toHaveText('0');
});

test('checking submission confirmation clears its stale error without sending automatically',async({page})=>{
  let commits=0;
  await page.route('**/api/commit',route=>{commits++;return route.fulfill({status:400,json:{error:'模拟远端错误：请重新预览'}});});
  await page.goto('/');await expect(page.locator('#products')).toContainText('coins_100');
  await page.locator('[data-edit="coins_100"]').click();await page.locator('[data-k="price"]').first().fill('7.65');await page.getByRole('button',{name:'保存草稿',exact:true}).click();
  await page.locator('#preview').click();await expect(page.locator('#dialogTitle')).toContainText('提交前预览');
  await page.getByRole('button',{name:'提交演示变更',exact:true}).click();await expect(page.locator('#modalError')).toContainText('请先核对并勾选变更确认');expect(commits).toBe(0);
  await page.locator('#confirmWrite').check();await expect(page.locator('#modalError')).toHaveCount(0);await expect(page.locator('#status')).not.toContainText('请先核对并勾选变更确认');expect(commits).toBe(0);
  await page.getByRole('button',{name:'提交演示变更',exact:true}).click();await expect(page.locator('#modalError')).toContainText('模拟远端错误');expect(commits).toBe(1);
  await page.locator('#confirmWrite').uncheck();await page.locator('#confirmWrite').check();await expect(page.locator('#modalError')).toContainText('模拟远端错误');expect(commits).toBe(1);
});
