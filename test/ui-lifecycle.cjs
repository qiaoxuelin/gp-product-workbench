'use strict';
// Shut down the server started by Playwright through its authenticated local API.
// This avoids depending on Windows shell process-tree termination at teardown.
module.exports=async config=>{
 const base=config.projects[0].use.baseURL;
 const response=await fetch(base+'/api/session',{signal:AbortSignal.timeout(5000)});
 const session=await response.json();
 if(!response.ok||session.application!=='gp-product-workbench'||!session.token)throw Error('Unexpected UI test server');
 return async()=>{
  const quit=await fetch(base+'/api/system/quit',{method:'POST',headers:{'Content-Type':'application/json','X-GP-Token':session.token},body:'{}',signal:AbortSignal.timeout(5000)});
  if(!quit.ok)throw Error('UI test server refused shutdown: '+quit.status);
  const deadline=Date.now()+5000;
  while(Date.now()<deadline){
   try{const check=await fetch(base+'/api/session',{signal:AbortSignal.timeout(500)});const current=await check.json();if(current.token!==session.token)return;}
   catch{return;}
   await new Promise(resolve=>setTimeout(resolve,100));
  }
  throw Error('UI test server did not stop after shutdown');
 };
};
