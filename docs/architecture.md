# 应用结构

PlayBatch 保留原有 CommonJS 和无生产 npm 依赖的运行方式。此次拆分不迁移用户数据、不改变 HTTP 协议和浏览器草稿格式。

| 模块 | 职责 |
| --- | --- |
| server.js | 组装依赖、项目配置、HTTP 会话校验、请求串行化与路由 |
| google-client.js | Google JWT/OAuth、令牌缓存、Android Publisher HTTP 通信 |
| google-products.js | Google 商品读取、演示数据、预览计划、提交记录及失败恢复 |
| google-product-rules.js | Google 购买选项状态转换与读回字段核对 |
| json-store.js | JSON 读取和临时文件替换写入 |
| core.js | 现有 Google 商品数据转换、价格、CSV、差异与校验 |
| credentials.js | Google 凭据格式及 Windows DPAPI 存储 |
| finance.js / review-monitor.js / feishu-notifications.js | 账单、审核监控、通知独立服务 |

客户端和商品服务通过工厂创建，导入模块本身不会启动服务器或读取用户数据。商品服务通过参数获得当前项目、平台请求和存储，测试可注入内存存储和模拟请求。每个实例独立持有令牌缓存或预览计划及演示数据。

项目切换和凭据变更继续清空令牌缓存及预览。提交仍校验项目指纹、检查远端冲突、记录各步骤并读回核对；HTTP 层继续串行处理业务请求。工厂本身不提供并发提交锁，调用者须维持此约束。

## 苹果接入边界

苹果内购已通过独立工作区接入，范围为消耗型与非消耗型，不含订阅。apple-workspace.js 管理苹果配置和路由，apple-client.js 处理签名与请求，apple-credentials.js 管理私钥，apple-products.js 负责商品流程；详见 apple-iap.md。新增苹果客户端、凭据校验和商品服务时应分别实现平台规则，不复用 Google 的 purchaseOptions、regionsVersion 或启用/停用状态模型。价格、多语言、审核和销售状态应按苹果接口分别处理。

平台在独立页面和 /api/apple/ 路由处分开，旧配置保持 Google；苹果浏览器草稿、预览及操作记录包含平台与项目身份，阻止跨平台提交。通用商品工作流只有在两侧实际实现后再提取，避免提前承诺不存在的统一接口。

## 验证与交付

运行 npm test 检查现有 HTTP 集成及模块实例隔离。build-release.ps1 的文件白名单已包含新增模块。此次未发布新版本，也未执行真实平台写入；自动化通过不代表真实授权或应用内购买验证完成。

测试生命周期由 test/ui-lifecycle.cjs 管理：从专属测试服务捕获会话，测试结束后请求退出并等待服务关闭。test/package-smoke.test.js 按实际发布白名单复制文件，在独立临时目录启动服务器并验证双平台静态入口，避免源码依赖掩盖打包遗漏。

## 统一项目与平台入口

workspace-projects.js 管理项目名称与 googleId / appleId 关联，workspace-projects.json 只保存关系；首次读取为每个未关联的平台配置生成独立项目，明确保存关联时才持久化。修订摘要阻止旧表单覆盖新关联，双平台项目中的应用不能直接被其他项目抢占。原平台配置、私钥和商品记录不迁移。

public/workspace-shell.js 在两页提供相同的项目选择和平台页签，通过现有 config/switch 接口选择当前平台应用。项目通过 URL 和本地访问记录保留；无效项目链接和缺少平台配置时，不展示其他项目的商品。原商品草稿键不变，切换前保存失败时保留当前页面。平台 API 继续校验应用身份和预览目标。


## Navigation hierarchy (2026-09-21)

- The left rail selects and creates projects. Project settings sits beside the current project heading, above platform navigation, and edits the project name and platform associations. Platform connection settings stays within the platform area.
- Google Play and App Store are sibling platform links under the selected project. Switching preserves project identity and each platform's draft storage.
- Platform links select Google Play or App Store. Beneath them, product management, review/publication monitoring, and billing are peer feature pages. Operation history and connection settings remain platform actions. The feature query parameter preserves the selected page across refreshes and platform switches.
- Monitoring defaults to the selected project's Google profile, ignoring the old independent monitor selection. Google operation history is filtered by current mode and package. Billing retains its explicit developer-account scope.
- Software-level update, help, diagnostics and shortcut management are available from either platform. public/system-tools.js owns their shared behavior. Update startup persists a complete workspace snapshot before restarting.
- Demo is an explicit standalone /?demo=1 workspace entered from Help and diagnostics. It hides project/platform navigation and preserves the last real project selection. Real project pages always use live mode; the old remembered demo preference is ignored. Demo and real draft storage keys remain unchanged.
- Both platforms share the same feature navigation. App Store monitoring and billing currently show explicit unavailable pages; they do not issue unsupported requests.

Validation: 49 backend/package checks passed. Browser regression: 30 of 31 passed initially; the update snapshot regression was repaired, then that test and the shared-project round trip passed. Desktop and 390px screenshots reviewed. The local service was restarted and its page refreshed; no release was published.

Feature-page validation: existing browser regression covered 31 flows; the obsolete billing-dialog assertion was updated and passed. A new peer-feature routing test passed, covering reload, cross-platform selection, unsaved settings cancellation, and 390px overflow. Monitoring and Feishu regression were rerun after the two-column layout and passed. Local monitoring page opened successfully with saved configuration; no configuration write or notification was triggered.

Final UI recheck: 32 browser regressions and 49 backend/package checks passed. Dynamic document titles now identify project/platform/feature. Monitor startup no longer reports product draft restoration. Returning from Feishu settings preserves unsaved monitor fields; the regression also verifies leave cancellation. PNG signature and packaged icon delivery were verified. Desktop utility position, decoded brand icon and 390px layout were checked. Local page was refreshed and confirmed.

Demo isolation validation: 26 browser flows passed in the full run after adapting real-mode fixtures; the two remaining legacy demo-URL assertions were corrected, and all 7 remaining flows passed in the targeted run (33 unique flows total). Explicit Help -> demo -> reload -> exit regression verifies real drafts and project identity are retained. The live local product page and Help entry were visually checked.
