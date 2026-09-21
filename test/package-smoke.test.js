'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),{spawn}=require('node:child_process');
test('release whitelist runs independently and serves both platform workspaces',async t=>{
 const root=path.resolve(__dirname,'..'),script=fs.readFileSync(path.join(root,'build-release.ps1'),'utf8');
 const stage=fs.mkdtempSync(path.join(os.tmpdir(),'gp-package-test-'));
 const quoted=text=>[...text.matchAll(/'([^']+)'/g)].map(m=>m[1]);
 const files=quoted(script.match(/\$gpFiles=@\(([^\n]+)\)/)[1]);
 for(const file of files)fs.copyFileSync(path.join(root,file),path.join(stage,file));
 const assetGroups=[...script.matchAll(/foreach \(\$gpFile in @\(([^)]+)\)\) \{ Copy-Item -LiteralPath \(Join-Path \$gpRoot "(public|vendor|docs)\\\$gpFile"\)/g)];
 assert.deepEqual(assetGroups.map(m=>m[2]).sort(),['docs','public','vendor']);
 for(const [,names,dir]of assetGroups){fs.mkdirSync(path.join(stage,dir));for(const file of quoted(names))fs.copyFileSync(path.join(root,dir,file),path.join(stage,dir,file));}
 assert(!fs.existsSync(path.join(stage,'data')));assert(!fs.existsSync(path.join(stage,'node_modules')));
 // Ask the OS for a free port; every required module must come from the staged files.
 const code="const probe=require('node:net').createServer();probe.listen(0,'127.0.0.1',()=>{const port=probe.address().port;probe.close(()=>{process.env.GP_PORT=String(port);const {server}=require('./server');server.listen(port,'127.0.0.1',()=>console.log(port));process.on('message',m=>{if(m==='stop'){server.close();server.closeAllConnections();process.disconnect()}})})})";
 const child=spawn(process.execPath,['-e',code],{cwd:stage,env:{...process.env,GP_DATA_DIR:path.join(stage,'test-data')},windowsHide:true,stdio:['ignore','pipe','pipe','ipc']});
 const exited=new Promise(resolve=>child.once('exit',resolve));let stderr='';child.stderr.on('data',d=>{stderr+=d;});
 t.after(async()=>{
  if(child.exitCode===null)child.send('stop');
  await Promise.race([exited,new Promise((_,reject)=>{const timer=setTimeout(()=>{child.kill();reject(Error('Staged server failed to stop'));},5000);timer.unref();})]);
  const resolved=fs.realpathSync(stage);if(path.dirname(resolved)!==fs.realpathSync(os.tmpdir())||!/^gp-package-test-/.test(path.basename(resolved)))throw Error('Unsafe test cleanup');
  fs.rmSync(resolved,{recursive:true,force:true});
 });
 const port=await new Promise((resolve,reject)=>{child.stdout.once('data',d=>resolve(Number(String(d).trim())));child.once('exit',code=>reject(Error('Staged server exited '+code+': '+stderr)));child.once('error',reject);});
 const origin='http://127.0.0.1:'+port;
 for(const file of ['/','/apple.html','/app.js','/apple.js','/workspace-shell.js','/system-tools.js','/style.css']){const response=await fetch(origin+file);assert.equal(response.status,200,file);assert((await response.text()).length>100);}
 const icon=await fetch(origin+'/playbatch-icon-v1.png');assert.equal(icon.status,200);assert(icon.headers.get('content-type').startsWith('image/png'));assert.deepEqual(Buffer.from(await icon.arrayBuffer()).subarray(0,8),Buffer.from([137,80,78,71,13,10,26,10]));
 const session=await(await fetch(origin+'/api/session')).json();assert.equal(session.application,'gp-product-workbench');
 assert(fs.existsSync(path.join(stage,'docs','apple-iap.md')));assert.equal(stderr,'');
});
