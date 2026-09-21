# 苹果内购上传

入口：先在工作台选择项目，再切换到 App Store 平台。Google Play 和 App Store 是同一项目下的并列平台；也可通过本机 /apple.html 进入。

## 当前支持

- 消耗型 CONSUMABLE、非消耗型 NON_CONSUMABLE。
- 项目下独立的 App Store 应用配置；团队 API Key 的 Key ID、Issuer ID 和 .p8 私钥。
- 读取商品、复制创建、CSV 批量导入导出、本机草稿、多语言名称与描述。
- 预览字段差异，确认后逐项上传；记录完成步骤并读回核对。
- 可选的初始基准价格：匹配 Apple 返回的金额档位，初始化没有价格计划的商品。保留已有价格计划。
- 部分写入后从操作记录核对当前值；不会自动重放写入。

当前不提供订阅、销售地区设置、已有价格计划调价、审核截图上传、送审或发布。这些步骤请在 App Store Connect 完成。上传已核对不代表商品通过审核或可在游戏中购买。

## 配置

新建或选择项目，切换到 App Store 后点击“平台应用与授权”（尚未关联时点击“配置 App Store”），填写应用配置名称、应用信息页中的数字 Apple ID 和 Bundle ID，以及团队 API Key 的 Key ID / Issuer ID，选择对应 .p8 文件。当前不支持个人 API Key。

可以先不选私钥来编辑本地草稿。读取与提交前必须导入私钥。私钥使用 Windows 当前用户 DPAPI 加密，保存在独立 apple-credential-*.dpapi 文件中，页面不回显。换 Windows 用户或电脑需要重新导入。

项目 App ID 和 Bundle ID 保存后不可改写；另一应用应新建项目。修改 Key ID 或 Issuer ID 时必须同时提供匹配的新私钥。

每次读取、预览或提交会先核对数字 App ID 对应的 Bundle ID。预览阶段还会提前验证初始价格的地区和币种，避免这类错误在创建商品后才出现。项目切换和授权变更使旧预览失效。

## CSV

在“导入 CSV”内下载模板。保存为 UTF-8，每种语言一行。同一商品各行的参考名称、类型和初始价格必须一致。

列：productId,name,inAppPurchaseType,reviewNote,locale,displayName,description,territory,currency,price

productId 最多 100 字符；参考名称最多 64；显示名称 2–30；描述最多 45；审核备注最多 4000。语言示例：en-US、zh-Hans、zh-Hant、ja。语言可用性最终由 Apple 校验。

未列出的商品和语言保留。省略 reviewNote 列会保留已有备注，列存在但留空表示清空备注。价格三列全部留空表示不添加价格操作；原本已存在的本机初始价格草稿会保留，如需撤销请在编辑器取消勾选。

价格示例：territory=USA，currency=USD，price=0.99。地区使用 Apple 三位代码。新商品必须先创建，才能查询它的价格档位；金额无匹配档位时可能已创建商品和文案，价格步骤会报告未完成。其他地区的自动价格由 Apple 处理，销售地区仍需单独配置。

## 文案版本和恢复

使用 v1/inAppPurchaseVersions 创建文案版本，v2/inAppPurchaseLocalizations 写入其多语言文案。没有版本的旧商品仅通过旧接口读取原有文案，不向旧接口写入。审核中的文案版本会阻止修改。本版不删除远端语言。

上传前检查远端快照；批次不是原子事务，每个商品和步骤可能独立成功。超时后不自动重试，可从“操作记录 → 核对结果”查看原目标与当前值。已完全一致的项目可清除待上传标记；其余项目选择载入当前值后，核对并编辑剩余内容，再生成新预览。单个商品的价格档位核对失败不会阻止其他商品核对；已读取的当前值仍可查看。读取失败的商品不提供载入操作，保留本机草稿。此操作不会覆盖 Apple 远端数据。

Google 配置、授权和浏览器草稿保持原格式；苹果使用 apple-config.json、apple-history.json、apple-operation-*.json 和 apple-workspace-v1 浏览器存储空间。

## 官方依据与验证边界

- [API 授权签名](https://developer.apple.com/documentation/appstoreconnectapi/generating-tokens-for-api-requests)
- [内购管理](https://developer.apple.com/documentation/appstoreconnectapi/managing-in-app-purchases)
- [文案版本流程](https://developer.apple.com/documentation/appstoreconnectapi/working-with-in-app-purchase-versions)
- [v2 迁移说明](https://developer.apple.com/documentation/appstoreconnectapi/migrating-in-app-purchase-metadata-to-v2)
- [内购字段限制](https://developer.apple.com/help/app-store-connect/reference/in-app-purchases-and-subscriptions/in-app-purchase-information)

2026-09-20 按官方文档实现；目前验证覆盖模拟 API、Windows 凭据加密和本机浏览器流程，尚未完成真实 Apple 账号上传及 StoreKit 购买验证。未执行送审或发布。

### 本轮验证记录

- 后端及打包：46 项通过，包含新增的预览币种检查、定价失败后的逐商品核对、读取失败保护，以及打包目录独立启动与静态资源检查。
- 完整 Playwright CLI 套件 28 项通过；随后新增的两项苹果保护测试与原苹果流程一起运行，3 项通过。共覆盖 30 个浏览器场景。
- 已修复 Windows 测试退出阻塞：测试生命周期使用启动时捕获的会话令牌关闭专属测试服务器，并等待其退出。无需通过手工结束进程来完成测试。
- 发布白名单复制出的目录可独立启动，Google 与 Apple 页面及脚本均可访问；不依赖源码目录的 node_modules 或用户 data。
- 未生成或发布新的安装包，未连接真实 Apple 账号执行商品写入、送审或购买验证。

### 2026-09-21 本地复测

- 后端、模拟接口与独立打包目录启动测试 46 项通过；完整浏览器测试 30 项通过。
- 检查界面截图发现预览、上传或核对结束后仍残留“正在处理…”提示，已改为相应的完成提示；苹果 3 项浏览器流程再次通过，包含完成状态断言。
- 使用隔离测试数据及模拟 Apple 接口，未向真实账号写入、送审或进行 StoreKit 购买验证；本次未发布安装包。

### 同项目管理两个平台

工作台顶部统一选择项目，Google Play 与 App Store 作为并列页签。项目设置中可以分别关联两边已有的应用配置；未配置的平台显示配置入口，不展示其他项目的数据。已有配置初次显示时各自作为独立项目，不按名称或包名自动配对，需由用户明确关联。

项目关系单独保存在 workspace-projects.json；平台凭据、商品记录和浏览器草稿仍使用原来的标识和存储位置。解除平台关联不会删除数据，该应用会作为独立项目继续显示。项目切换会保存当前草稿，若保存失败则阻止切换。

本次项目层级调整验证：49 项后端与接口测试通过，31 项浏览器测试通过；额外核对打包目录包含共享导航脚本。双平台切换、刷新恢复草稿、未配置平台隔离及 390 / 900 像素宽度均已验证，未执行真实平台写入或发布新安装包。
