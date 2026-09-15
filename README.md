# GP 商品工作台

在本机通过 Google Play Developer API 管理一次性商品。Node.js 22+，无需 npm install，无云端部署。

## 下载免安装版

从 [GitHub Releases](https://github.com/qiaoxuelin/gp-product-workbench/releases/latest) 下载 Windows x64 ZIP，完整解压后双击 **启动工具.cmd**。内置 Node.js，无需安装开发环境。首次使用需自行配置 Google 授权。

发布版数据保存在 %LOCALAPPDATA%/GP-Product-Workbench；升级时先停止旧版再启动新版。草稿保存在原浏览器中。下文 data/ 指源码运行的数据目录。

## 启动

双击 **start.cmd**。浏览器打开 http://127.0.0.1:4318 ，服务在后台运行。
关闭浏览器不会停止服务；双击 **stop.cmd** 停止。命令行也可用 npm start。
请始终使用同一个浏览器和 127.0.0.1 地址，以便恢复本机草稿。

## 多项目配置

1. 进入“连接设置”，选择“新增项目”。
2. 填项目显示名称、Android 包名，选择服务账号 JSON 文件或粘贴完整 JSON。也可先保存项目，稍后导入。
3. 保存后切换到真实项目，点击“读取商品”测试连接。
4. 首页项目选择框可切换应用。各项目可以复用同一个已获相应权限的服务账号，也可以使用不同账号。
5. 项目和包名保存在 data/config.json；导入的凭据使用 Windows DPAPI 当前用户加密，保存在 data/credential-*.dpapi。页面只返回邮箱、保存状态与时间，不回显私钥。
6. 在同一浏览器中，草稿按项目 ID 和包名隔离。其他标签页切换了项目时，旧页面的真实操作会被拒绝。

Google 授权准备：
https://developers.google.com/android-publisher/getting_started
在 Google Cloud 启用 Google Play Developer API，在 Play Console 邀请服务账号并授予目标应用所需权限。
本版支持服务账号 JSON；尚未实现个人 OAuth 登录。详细步骤见工具设置页“如何准备 Google 授权？”或 [完整授权指南](GOOGLE_AUTH_GUIDE.html)。\n\n替换：在对应项目选择新文件或粘贴新 JSON 后保存；留空保留原凭据。非法 JSON 或加密失败不会替换原凭据；替换成功清除旧访问令牌及失效预览。替换本机凭据不会自动撤销 Google 中的旧密钥。加密文件依赖当前 Windows 用户环境，迁移电脑/用户时请重新导入原始 JSON。不要将原始密钥放入代码仓库。

## 常用操作

- **读取商品**：自动翻页读取全部商品。未提交草稿可选择保留或放弃；保留时仍保留原版本，避免覆盖远端变化。
- **编辑**：多语言名称/描述、购买选项、地区价格/销售状态、旧版兼容、多件购买。高级 JSON 可编辑官方资源其他字段。
- **复制创建**：选择一个模板，每行填写一个新商品 ID。复制名称、描述及配置；新选项创建为 DRAFT，单独启用。
- **批量改价**：选择商品，指定地区、可选购买选项 ID；支持限定币种的固定价格、按比例调整和 Google 基准价换算。
- **基准换算**：输入为税前基准价，地区结果含税；先预览再应用到草稿。默认仅更新既有且选中的地区；也可选择“添加并设为可销售：Google 返回的全部地区”，新增缺少地区并替换返回地区的价格与销售状态。商品税务类别须一致，同一批次使用同一基准价，应按价格档位分批。应用发行地区与未来新地区规则不变。
- **启用/停用**：单独加入待提交状态变化，通过 Google 专用状态接口执行。
- **预览并提交**：有选择时提交所选商品，否则预览全部待提交商品。显示目标项目、包名、字段差异和金额变化。勾选核对后执行。
- **结果**：逐商品提交并读回。新商品不会自动启用。每次最多 500 个商品，逐商品使用 batchUpdate，方便隔离失败。
- **重试**：确定未写入的失败项保留草稿，可修正后重新预览。网络中断或读回不一致标记为状态不确定/待核对，先查看后台和操作记录，不能直接盲目重试。

## 导入导出

CSV 列：
productId,purchaseOptionId,languageCode,title,description,regionCode,currencyCode,price,availability

每行表达一个商品、购买选项、语言、地区组合。多语言与多地区可重复组合，但同一字段重复值必须一致。
UTF-8（支持 BOM）。名称/描述支持带引号的逗号和换行。
CSV 按标识合并；只修改文件列出的名称、描述、地区价格与销售状态，保留未列出的地区、购买选项和高级字段。
CSV 不修改启用状态，不等于完整配置备份。完整 JSON 导出保留全部商品字段，适合备份和高级编辑。
JSON 导入须与当前项目包名一致；不能直接用另一个项目的包名覆盖当前项目。
导出优先导出所选商品，未选择时导出全部当前草稿。

## 数据与安全边界

- 仅监听 127.0.0.1，不提供局域网访问。
- Host/Origin 检查、每次启动随机会话令牌，避免其他网站调用本地接口。
- 服务账号使用 Node 内置 crypto 签署 JWT，只向 Google 固定官方端点请求令牌。
- 草稿在浏览器 localStorage；演示商品在 data/demo.json；连接配置、操作记录在 data/。
- 操作记录包括写入前后商品配置和结果，不保存访问令牌和私钥。导入 JSON 仅用于本机服务加密保存及后续向 Google 认证，不放入浏览器 localStorage。
- 提交预览 15 分钟有效，单次使用；连接配置改变立即失效。
- 预览及写入前均检查远端数据是否改变。Google 未提供此工具可使用的原子条件写入锁，检查后到写入前仍有短暂并发窗口，批量操作时避免同时在其他工具改同一商品。
- Google 成功返回后仍需要传播时间；读回核对不代表游戏内价格已经更新。实际购买流程需用目标应用另行验证。
- 确认页面显示真正写入目标。不要将服务账号私钥提交到源码仓库。

## 当前范围

已实现：一次性商品常规编辑、多项目、批量复制、地区改价、启用停用、CSV/JSON、差异、日志、演示模式。
高级税务/租赁/标签/新地区规则通过 JSON 编辑，保留原配置。
未实现：商品图标、促销优惠管理、订阅商品、商品删除、个人 OAuth、自动回滚、跨项目一键复制、定时改价。
演示模式不模拟 Google 汇率换算，换算需真实授权。
本地校验覆盖基础字段、金额精度、重复项及结构；Google 的币种/地区、价格上下限、权限和合规约束仍以远端校验为准。

## 验证

npm test
覆盖金额精度、币种小数位、CSV 合并/冲突、字段保留、只读字段、预览单次使用、远端冲突、多项目隔离、模拟 Google 写入协议、网络中断结果。
真实 Google 连接和实际商品写入需要配置服务账号后验证，不以演示或模拟测试替代。

官方协议快照：google-api-discovery.json（2026-09-15 从官方 Discovery API 获取）
https://developers.google.com/android-publisher/api-ref/rest/v3/monetization.onetimeproducts
https://developers.google.com/android-publisher/api-ref/rest/v3/monetization.onetimeproducts/batchUpdate
https://developers.google.com/android-publisher/api-ref/rest/v3/monetization.onetimeproducts.purchaseOptions/batchUpdateStates
https://developers.google.com/android-publisher/api-ref/rest/v3/monetization/convertRegionPrices

浏览器验证：首次执行 npm install，然后 npm run test:ui（使用本机 Edge）。
2026-09-15：6 组核心/HTTP 测试通过，Edge 端到端测试通过，首页/价格差异/窄屏截图已检查。测试使用独立临时目录和演示数据，没有连接真实 Google 账号。

2026-09-15 授权体验更新：支持文件导入/粘贴 JSON、凭据保留及替换、Windows 当前用户加密保存、密钥不回显；设置页提供详细 Google Cloud/Play Console 授权教程。
\n页面会记住同一浏览器上次访问的项目与演示/真实模式，刷新或重新打开时恢复，并加载该项目原有草稿。旧版本尚无访问记录时优先使用已配置的当前项目。\n\n## 多语言模板\n\n勾选商品后点击“多语言模板”（不勾选则使用当前项目全部商品），下载 CSV UTF-8 模板。可输入额外语言代码追加待填写行。模板仅含 productId、languageCode、title、description 四列。用 Excel 编辑后另存为 CSV UTF-8，上传检查并预览，再应用到草稿。未列出的语言和价格/地区/购买选项均保留。当前不支持直接上传 .xlsx。\n\n## CSV 导入全部地区\n\n点击“导入 CSV → 下载全部地区 CSV 模板”。regionCode 填 ALL；price 是税前基准价，currencyCode 是基准币种，availability 填 AVAILABLE。不同商品可各自填写不同价格。导入时通过 Google 换算地区价格并保存最新地区版本，生成本地草稿。多语言按同一商品重复语言行即可；同一购买选项的 ALL 基准价需一致，不能混入单地区行。特殊地区改价可在导入后操作。现有商品税务类别会用于换算，新商品使用 Google 默认类别。真实提交前核对价格及销售状态；演示模式无法进行 Google 地区换算。\n
### 表单选择控件

模板追加语言和批量改价地区使用可搜索的勾选列表，支持全选搜索结果、清空和已选数量。商品编辑的语言、地区、币种，以及批量改价的币种、购买选项和税务类别使用下拉选项；现有特殊代码保留。语言列表参照 Google Play 本地化帮助；地区下拉提供标准地区代码，具体可销售地区与币种仍由 Google 校验，“全部地区”换算以 Google 返回结果为准。
