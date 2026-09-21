'use strict';
const fs=require('node:fs'),path=require('node:path');
function createJsonStore(DATA) {
fs.mkdirSync(DATA,{recursive:true});
const read=(name,fallback)=>{try{return JSON.parse(fs.readFileSync(path.join(DATA,name),'utf8'));}catch(e){if(e.code==='ENOENT')return fallback;throw e;}};
const save=(name,obj)=>{const dest=path.join(DATA,name);fs.writeFileSync(dest+'.tmp',JSON.stringify(obj,null,2),{mode:0o600});fs.renameSync(dest+'.tmp',dest);};

return {read,save};
}
module.exports={createJsonStore};
