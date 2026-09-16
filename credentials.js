'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),{execFileSync}=require('node:child_process');
function parseCredential(text){
  let key;try{key=JSON.parse(String(text).replace(/^\uFEFF/,''));}catch{throw Error('服务账号 JSON 格式错误，请选择下载的原始文件或粘贴完整内容');}
  if(!key||key.type!=='service_account'||typeof key.client_email!=='string'||!key.client_email.endsWith('.gserviceaccount.com')||typeof key.private_key!=='string')throw Error('需要服务账号 JSON（type=service_account），不是 API Key 或 OAuth 客户端文件');
  try{const privateKey=crypto.createPrivateKey(key.private_key);if(privateKey.asymmetricKeyType!=='rsa')throw Error();}catch{throw Error('JSON 中的 RSA 私钥无效');}
  return key;
}
function protect(input,decrypt=false){
  if(process.platform!=='win32')throw Error('凭据加密需要 Windows 当前用户环境');
  const script="Add-Type -AssemblyName System.Security; $inputText=[Console]::In.ReadToEnd(); "+(decrypt?
    "[Text.Encoding]::UTF8.GetString([Security.Cryptography.ProtectedData]::Unprotect([Convert]::FromBase64String($inputText),$null,[Security.Cryptography.DataProtectionScope]::CurrentUser))":
    "[Convert]::ToBase64String([Security.Cryptography.ProtectedData]::Protect([Text.Encoding]::UTF8.GetBytes($inputText),$null,[Security.Cryptography.DataProtectionScope]::CurrentUser))");
  try{return execFileSync(path.join(process.env.SystemRoot||'C:\\Windows','System32','WindowsPowerShell','v1.0','powershell.exe'),['-NoProfile','-NonInteractive','-Command',script],{input,encoding:'utf8',windowsHide:true,timeout:15000,maxBuffer:1024*1024,stdio:['pipe','pipe','pipe']}).trim();}
  catch{throw Error(decrypt?'无法解密凭据，请用保存时的 Windows 用户运行，或重新导入 JSON':'Windows 凭据加密失败，未保存凭据');}
}
function storeCredential(data,text){
  if(Buffer.byteLength(String(text))>65536)throw Error('服务账号 JSON 超过 64KB');
  const key=parseCredential(text),file='credential-'+crypto.randomUUID()+'.dpapi';
  const encrypted=protect(JSON.stringify(key));
  fs.writeFileSync(path.join(data,file),encrypted,{mode:0o600,flag:'wx'});
  return {credentialFile:file,credentialEmail:key.client_email,credentialUpdatedAt:new Date().toISOString()};
}
function credentialFilePath(data,file){
  if(!/^credential-[a-f0-9-]+\.dpapi$/.test(file||''))throw Error('凭据存储标识无效');
  return path.join(data,file);
}
function loadCredential(data,profile){
  if(profile.credentialFile)return parseCredential(protect(fs.readFileSync(credentialFilePath(data,profile.credentialFile),'utf8'),true));
  // Compatibility for previously configured paths. A subsequent JSON import replaces this reference.
  if(profile.credentialPath){try{return parseCredential(fs.readFileSync(profile.credentialPath,'utf8'));}catch{throw Error('旧凭据文件无法读取，请在连接设置中重新导入 JSON');}}
  throw Error('请先在连接设置中选择或粘贴服务账号 JSON 并保存');
}
function removeCredential(data,file){if(file){try{fs.unlinkSync(credentialFilePath(data,file));}catch{/* The active pointer is already persisted; an orphan encrypted file is harmless. */}}}
function publicProfile(p){return {id:p.id,name:p.name,packageName:p.packageName,financialBucket:p.financialBucket||'',hasCredential:Boolean(p.credentialFile||p.credentialPath),credentialEmail:p.credentialEmail||'',credentialUpdatedAt:p.credentialUpdatedAt||'',legacyCredential:Boolean(p.credentialPath&&!p.credentialFile)};}
module.exports={parseCredential,storeCredential,loadCredential,removeCredential,publicProfile};
