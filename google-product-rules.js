'use strict';
const C=require('./core');
function checkTransitions(before,after,states) {
  for(const o of after.purchaseOptions) {
    const old=before?.purchaseOptions.find(x=>x.purchaseOptionId===o.purchaseOptionId);
    if(o.state!==old?.state && o.state!==undefined)throw Error('请使用启用/停用功能修改状态；新选项创建为草稿');
    for(const r of o.regionalPricingAndAvailabilityConfigs) {
      const prior=old?.regionalPricingAndAvailabilityConfigs?.find(x=>x.regionCode===r.regionCode);
      if(r.availability==='NO_LONGER_AVAILABLE'&&!['AVAILABLE','NO_LONGER_AVAILABLE'].includes(prior?.availability))throw Error(r.regionCode+' 不能从未销售直接改为停止销售');
    }
  }
  if(before)for(const o of before.purchaseOptions)if(!after.purchaseOptions.some(x=>x.purchaseOptionId===o.purchaseOptionId))throw Error('此版本不允许移除已有购买选项');
  for(const [id,target] of Object.entries(states||{})) {
    if(!['ACTIVE','INACTIVE'].includes(target))throw Error('状态目标无效');
    const old=before?.purchaseOptions.find(o=>o.purchaseOptionId===id);
    if(!after.purchaseOptions.some(o=>o.purchaseOptionId===id))throw Error('目标购买选项不存在');
    if(target==='INACTIVE'&&!['ACTIVE','INACTIVE'].includes(old?.state))throw Error('只有已启用的购买选项可以停用');
  }
}
function projectContains(actual,expected) {
  if(expected?.currencyCode&&actual?.currencyCode)return expected.currencyCode===actual.currencyCode&&C.decimal(expected)===C.decimal(actual);
  if(actual===undefined&&(expected===false||expected===0||Array.isArray(expected)&&!expected.length))return true;
  if(expected===undefined)return actual===undefined;
  if(expected===null||typeof expected!=='object')return C.equal(actual,expected);
  if(Array.isArray(expected)){
    if(!Array.isArray(actual)||actual.length!==expected.length)return false;
    const key=['purchaseOptionId','languageCode','regionCode','tag'].find(k=>expected.length&&expected.every(x=>x?.[k]));
    return expected.every((v,i)=>projectContains(key?actual.find(x=>x[key]===v[key]):actual[i],v));
  }
  if(!actual||typeof actual!=='object')return false;
  return Object.keys(expected).every(k=>projectContains(actual[k],expected[k]));
}

module.exports={checkTransitions,projectContains};
