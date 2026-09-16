'use strict';
const crypto=require('node:crypto');
const SCOPE='https://www.googleapis.com/auth/devstorage.read_only';
const MAX_BYTES=100*1024*1024;
function normalizeBucket(value){
  let bucket=String(value||'').trim();
  if(bucket.startsWith('gs://'))bucket=bucket.slice(5).split('/')[0];
  if(!/^[a-z0-9][a-z0-9._-]{1,220}[a-z0-9]$/.test(bucket)||bucket.includes('..'))throw Error('请粘贴 Play Console 的 Cloud Storage URI（gs://…）或存储桶名称');
  return bucket;
}
function monthPrefix(month){
  if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(month||''))throw Error('请选择有效账单月份');
  return 'earnings/earnings_'+month.replace('-','');
}
function reportName(name,prefix){
  return typeof name==='string'&&name.startsWith(prefix)&&
    new RegExp('^'+prefix+'(?:[._-][a-zA-Z0-9._-]+)?\\.(zip|csv)$').test(name);
}
async function request(url,token){
  const response=await fetch(url,{headers:{Authorization:'Bearer '+token},signal:AbortSignal.timeout(120000),redirect:'error'});
  if(!response.ok){
    let detail='';try{detail=(await response.json()).error?.message||'';}catch{}
    if(response.status===403)throw Error('账单访问被拒绝（Google 403）。请核对存储桶及服务账号，并在 Play Console 账号级权限中授予查看应用信息/下载批量报告及查看财务数据的全局权限。'+detail);
    if(response.status===404)throw Error('账单或报告版本不存在，请重新读取账单列表并核对存储桶。');
    throw Error('账单读取失败（Google '+response.status+'）：'+detail);
  }
  return response;
}
function createFinance(getToken){
  const tickets=new Map();
  function clean(){for(const [key,t] of tickets)if(t.expires<Date.now())tickets.delete(key);}
  return {
    async list(config,month){
      const bucket=normalizeBucket(config.financialBucket),prefix=monthPrefix(month),token=await getToken(SCOPE);
      clean();const files=[],seenPages=new Set();let page='';
      do{
        if(seenPages.has(page)||seenPages.size>=100)throw Error('报告分页异常，请稍后重试');
        seenPages.add(page);
        const query=new URLSearchParams({prefix,maxResults:'500',fields:'items(name,size,updated,generation,md5Hash),nextPageToken',...(page?{pageToken:page}:{})});
        const data=await (await request('https://storage.googleapis.com/storage/v1/b/'+encodeURIComponent(bucket)+'/o?'+query,token)).json();
        for(const item of data.items||[]){
          if(!reportName(item.name,prefix))continue;
          if(!/^\d+$/.test(String(item.size))||!/^\d+$/.test(String(item.generation)))throw Error('Google 报告元数据不完整，无法验证下载版本');
          const id=crypto.randomUUID(),file={id,name:item.name.slice('earnings/'.length),size:String(item.size),updated:item.updated||'',generation:String(item.generation)};
          files.push(file);
          tickets.set(id,{...item,bucket,profileId:config.id,credential:config.credentialFile||config.credentialPath||'',month,expires:Date.now()+15*60000});
          if(files.length>2000)throw Error('当月报告过多，请从 Play Console 下载');
        }
        page=data.nextPageToken||'';
      }while(page);
      return {bucket,month,scope:'developer-account',files};
    },
    async download(config,id){
      clean();const item=tickets.get(id);
      if(!item||item.profileId!==config.id||item.bucket!==config.financialBucket||item.credential!==(config.credentialFile||config.credentialPath||''))throw Error('下载列表已失效或项目已切换，请重新读取账单');
      if(BigInt(item.size)>BigInt(MAX_BYTES))throw Error('该账单超过 100MB，请从 Play Console 下载原始报告');
      const token=await getToken(SCOPE);
      const query=new URLSearchParams({alt:'media',generation:item.generation});
      const response=await request('https://storage.googleapis.com/storage/v1/b/'+encodeURIComponent(item.bucket)+'/o/'+encodeURIComponent(item.name)+'?'+query,token);
      const chunks=[];let count=0;
      try{for await(const chunk of response.body){count+=chunk.length;if(count>MAX_BYTES||BigInt(count)>BigInt(item.size))throw Error('账单大小与列表不符，未导出；请重新读取列表');chunks.push(Buffer.from(chunk));}}catch(e){throw Error('账单下载未完成：'+e.message);}
      const bytes=Buffer.concat(chunks);
      if(BigInt(bytes.length)!==BigInt(item.size))throw Error('账单下载不完整，未导出');
      if(item.md5Hash&&crypto.createHash('md5').update(bytes).digest('base64')!==item.md5Hash)throw Error('账单校验失败，未导出，请重新下载');
      return {bytes,name:item.name.slice('earnings/'.length),sha256:crypto.createHash('sha256').update(bytes).digest('hex')};
    }
  };
}
module.exports={createFinance,normalizeBucket,monthPrefix,reportName,SCOPE};
