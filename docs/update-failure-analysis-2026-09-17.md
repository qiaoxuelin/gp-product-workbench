# Windows 自动更新停在安装阶段

## 结论

旧版 updater.js 使用 Node spawn 的 detached:true + windowsHide:true 启动 Windows PowerShell。真实旧包的完整更新复现中，PowerShell 以 0 退出，但没有执行 update-install.ps1。任务锁仍为旧服务 PID，旧服务持续运行，页面持续显示安装中。

旧代码只在退出码非零时记录失败，因此这个零退出码漏报；旧服务随后重启时发现任务锁的所有者已经退出，就生成用户提供的“上次更新意外中断”提示。该复现未锁屏。

## 有效证据

- `test/update-release-smoke.cjs 0.1.8`：从原始 ZIP 解压，未改版本或源代码，通过真实旧页面按钮调用旧服务器更新接口，实际从 GitHub 下载 0.1.14；持续观察 180 秒，卡住。现场在 `dist/update-real-nNRJm3`，包含 responses.json、截图、下载任务和状态。安装助手不存在，锁仍为旧服务 PID 33960。
- `test/powershell-launch-probe.cjs`：八组真实启动对照。detached=true 的四组均退出 0 且未写入脚本标记；detached=false 的四组均执行脚本。NonInteractive 和输出重定向没有改变结论。现场在 `dist/ps-launch-OrPVkV`。
- 只替换 updater.js 并增加 update-runner.js 后，真实 0.1.8 -> 0.1.14 和 0.1.13 -> 0.1.14 均完成下载、安装、旧服务停止、新服务启动和浏览器自动刷新。分别约 40 秒和 37 秒；现场在 `dist/update-real-8tSEYu` 与 `dist/update-real-sap3Wn`。
- updater 与 runner 的 6 项测试通过，包含零退出码但没有安装结果应失败、保留安装失败原因。
- 最终 0.1.15 ZIP 解压启动检查通过，页面显示 0.1.15，包内包含 update-runner.js。现场在 `dist/update-real-oizBzZ`。

之前生成的 `dist/update-013-to-014-smoke.ps1` 和 `dist/update-008-to-014-smoke.ps1` 不构成旧版真实升级证据：它们解压的是 0.1.14，只改 package.json 的版本号，并绕过 updater.js 直接启动安装脚本。之前基于这两次测试的结论已撤回。

## 修复

独立 Node 更新助手保留 detached，用于跨越旧服务器退出；助手以非 detached 方式启动 PowerShell，并等待实际安装结果。增加启动确认、检测无结果退出和 update-helper.log。发布构建包含新助手。

Node 的 detached 生命周期说明：[官方 child_process 文档](https://nodejs.org/api/child_process.html#optionsdetached)。这解释为何不能只移除原来的 detached；本次缺陷本身由上述本机实验确认。

## 交付与边界

本地构建 `dist/PlayBatch-0.1.15-Windows-x64.zip`，SHA256：
`01074237fc9f29eb66409113529846bd349707f780dbcabb61d68f4933e41b8a`。

此调查未操作其他用户的电脑；发布状态以 GitHub Releases 为准。用户应先运行旧目录的停止工具.cmd，再完整解压此包并运行新目录的启动工具.cmd。保持原 Windows 用户、数据目录、浏览器和端口，原项目及凭据继续使用。旧更新器本身存在缺陷，因此受影响的旧版本需要这次手动换包。
