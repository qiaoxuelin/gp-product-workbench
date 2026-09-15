const {defineConfig}=require('@playwright/test');
const os=require('node:os'),fs=require('node:fs'),path=require('node:path');
const testData=fs.mkdtempSync(path.join(os.tmpdir(),'gp-ui-'));
module.exports=defineConfig({
  testDir:'./test',testMatch:'ui.spec.js',workers:1,timeout:60000,
  outputDir:'./data/ui-results',reporter:'list',
  use:{baseURL:'http://127.0.0.1:14320',headless:true,viewport:{width:1440,height:1000},launchOptions:{channel:'msedge'},screenshot:'only-on-failure'},
  webServer:{command:'node server.js',url:'http://127.0.0.1:14320/api/session',env:{GP_PORT:'14320',GP_DATA_DIR:testData},reuseExistingServer:false,timeout:15000}
});
