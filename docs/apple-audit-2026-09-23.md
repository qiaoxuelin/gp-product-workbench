# 苹果功能检查（2026-09-23）

更新：下列审查发现已在同日完成本地源码修复，保留原复现记录供核对。修复覆盖 4 项缺陷及当前基准价格导出；验证结果见本文末尾。

范围：当前 D:/trytry/GP 源码，包含上一轮地区接口修复及模板补全。检查授权、接口参数、商品读取、CSV、预览/提交、核对恢复、跨项目本机草稿。

本轮仅检查和记录，未修改业务代码，未读取真实凭据或调用真实 Apple 商品写入。使用现有模拟接口、隔离 VM 和全请求拦截的无头 Edge 浏览器复现。

## 已确认问题

### 1. P1：保存草稿的异步响应可写入另一个项目

位置：public/apple.js:60（保存草稿）、24（run）、125（Esc 取消）。

复现：在 A 项目新建商品，延迟 /api/apple/validate 响应；点击保存草稿后按 Esc，切换到 B 项目，再让 A 的校验返回成功。实际 A 的商品被写入 B 的 localStorage；A 的草稿仍为空。

隔离浏览器观测：页面标题为 Audit B；apple-workspace-v1:audit-b:100002 的 draft 包含 Draft belonging to A；apple-workspace-v1:audit-a:100001 的 draft 为空。

原因：保存仅调用 api，未设置 working；返回后 replace 使用已经变化的全局 draft/settings。Esc 和项目切换不会被阻止，也没有检查发起请求时的项目身份。

影响：本机草稿串项目；之后若用户在 B 确认上传，可能把 A 的商品创建到 B。此次只复现本机串项目，未执行真实上传。

修复建议：保存、CSV 检查等异步编辑操作冻结目标身份；返回时核对身份，或将结果保存到原项目。等待期间阻止关闭/切换与重复保存，并补延迟响应测试。

### 2. P1：远端核对成功后，新草稿仍绑定过期快照

位置：public/apple.js:95（applyVerified），apple-products.js:69（远端快照比较）。

复现：一笔已完成的新商品上传尚未同步到本机 base，用户已把同商品草稿改为 Newer draft。操作记录核对返回 verified、实际远端商品和旧目标。applyVerified 因新草稿不等于旧目标直接 continue，base 仍为空。继续预览新草稿时后端报“远端已变化或商品已存在，请先读取核对”。

影响：核对没有完成状态恢复，用户无法直接继续上传已保留的新修改。重新读取会替换草稿，必须另行导出或手工恢复。

修复建议：在核对结果适用于当前项目/快照时更新 base，单独保留与旧目标不同的 draft；若远端还有其他变化，应做三方比较并呈现冲突，避免用新的 base 隐藏远端修改。

### 3. P2：CSV 未知列被静默忽略

位置：apple-products.js:22–32（importCSV）。

复现 A：六个必要列正确，另填 reviewNotes。导入成功，但审核备注内容消失。

复现 B：六个必要列正确，价格列写成 baseTerritory,currencyCode,initialPrice，行内为 USA,USD,0.99。导入仍成功，生成的商品不含 initialPrice，没有未知列提示。

原因：只检查必要列存在，按已知名称提取字段，额外表头不会进入 validate。

影响：用户以为价格或审核资料已导入，实际上被丢弃。

修复建议：以完整表头白名单检查额外列；报出不支持的列和预期拼写。若支持别名，需显式映射且处理冲突。

### 4. P2：与远端相同的初始价格会一直显示待上传

位置：public/apple.js:9（dirty），apple-products.js:75–78（价格一致判断和空预览）。

复现：远端商品已有 USA/USD/0.99 价格计划，读取商品后导入完全相同内容及价格。前端因 initialPrice 存在判定 dirty=true；后端确认价格与文案一致，返回“没有待提交修改”，前端未清除该价格操作。

影响：界面持续显示待更新，预览无法完成；需要手动取消初始价格勾选或撤销草稿。

修复建议：预览返回逐商品的无变化结果，确认当前目标与响应对应后清除已满足的价格操作，同时保留其他未完成项。

## 功能限制（与上述缺陷区分）

- 读取远端后导出的 CSV 仅保留可编辑文案；已有价格计划不会转换为 territory/currency/price，实际导出三列为空。当前 CSV 不能作为完整商品定价备份。
- 已有价格计划调价、销售地区、审核截图上传、订阅、送审/发布未接入，文档已有说明。
- 苹果其他功能页（例如审核监控/财务等）由共享导航显示“暂未支持”。
- 团队 API Key 路径有签名和凭据保护测试；个人 API Key 不在当前支持范围。

## 接口核对

已对照 Apple 官方地区列表、商品列表筛选、价格档位、手动价格列表及版本迁移资料。地区 GET_INSTANCE 问题已在上一轮改为集合查询；本轮没有确认第二个同类接口路径错误。

官方依据：

- https://developer.apple.com/documentation/appstoreconnectapi/get-v1-territories
- https://developer.apple.com/documentation/appstoreconnectapi/get-v1-apps-_id_-inapppurchasesv2
- https://developer.apple.com/documentation/appstoreconnectapi/get-v2-inapppurchases-_id_-pricepoints
- https://developer.apple.com/documentation/appstoreconnectapi/get-v1-inapppurchasepriceschedules-_id_-manualprices
- https://developer.apple.com/documentation/appstoreconnectapi/working-with-in-app-purchase-versions
- https://developer.apple.com/documentation/appstoreconnectapi/migrating-in-app-purchase-metadata-to-v2

## 验证记录与边界

- node --test test/apple.test.js test/apple-http.test.js：10 项通过。
- node node_modules/@playwright/test/cli.js test test/apple-ui.spec.js：3 项通过。
- 独立无头 Edge 浏览器延迟响应场景：确认 A 草稿进入 B 项目。
- 对实际 applyVerified/dirty/importCSV/preview 代码的隔离调用：确认问题 2、3、4。
- 原测试通过说明已覆盖场景仍可运行；上述边界问题没有被原套件有效覆盖。
- 未做真实 Apple 账户上传、StoreKit 购买或发布验收。

建议修复顺序：跨项目异步结果隔离 → 核对恢复快照 → CSV 未知列保护 → 无变化价格状态。

## 修复完成记录

- 项目隔离：异步编辑/导入等操作设置忙碌状态，阻止 Esc、关闭、切换和重复操作；API 与任务完成时核对项目身份，失败后保留不可改字段的原始禁用状态。
- 核对恢复：结果携带原快照；确认仍对应当前本机快照时更新 base，保留新草稿及不同的待设置价格；不匹配的历史记录显示冲突并保留本机状态。
- CSV：未知表头报错，价格与审核备注不再被静默忽略。
- 无变化项：预览返回已一致商品，前端清除其待上传状态；混合批次只提交真正修改的商品。已安排未来调价的当前有效价格也按无变化处理。
- 导出：通过只读查询补齐当前基准地区、币种和金额，优先使用本机待设置价格；过滤过期、未来及非基准地区记录，无法确定唯一当前金额时明确报错。其他地区和未来调价计划仍不属于 CSV 导出范围。

最终验证：苹果后端与 HTTP 测试 15 项通过；苹果 Playwright 浏览器测试 12 项通过；git diff --check 通过。使用隔离数据与模拟 Apple 接口，未执行真实商品写入，未生成或发布安装包。

推送前完整回归：55 项后端/HTTP/独立打包目录测试、42 项浏览器测试全部通过，git diff --check 通过。远端 main 与本地提交基线一致。本次同步源码及文档，不生成安装包或发布版本。
