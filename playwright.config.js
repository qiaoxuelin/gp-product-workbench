const {defineConfig}=require('@playwright/test');
const os=require('node:os'),fs=require('node:fs'),path=require('node:path');
const edgePath=process.env.GP_EDGE_EXECUTABLE||['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe','C:/Program Files/Microsoft/Edge/Application/msedge.exe'].find(p=>fs.existsSync(p));
const testData=fs.mkdtempSync(path.join(os.tmpdir(),'gp-ui-'));
module.exports=defineConfig({
  globalSetup:require.resolve('./test/ui-lifecycle.cjs'),
  testDir:'./test',testMatch:['ui.spec.js','apple-ui.spec.js','workspace-ui.spec.js'],workers:1,timeout:60000,
  outputDir:'./data/ui-results',reporter:'list',
  use:{baseURL:'http://127.0.0.1:14320',headless:true,viewport:{width:1440,height:1000},launchOptions:edgePath?{executablePath:edgePath}:{channel:'msedge'},screenshot:'only-on-failure'},
  webServer:{command:'node server.js',url:'http://127.0.0.1:14320/api/session',env:{GP_PORT:'14320',GP_DATA_DIR:testData},reuseExistingServer:false,timeout:15000}
});
