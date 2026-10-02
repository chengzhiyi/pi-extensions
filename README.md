# pi-extensions

Pi 扩展与 pi-webapp 浏览器 UI 的 pnpm 工作区。首批包：

- [`@chengzhiyi/pi-web-protocol`](packages/protocol/README.md)：版本化清单、浏览器贡献声明、会话动作与等待用户决定的交互协议。
- [`@chengzhiyi/pi-plan-mode`](packages/plan-mode/README.md)：Pi 只读计划模式，提供计划徽章、审批卡、交互式提问和文档预览。

要求 Node.js 22.19+、pnpm 10.18.1。联合开发使用相邻目录中的 `pi-webapp`。
根项目保持私有；协议包和计划插件通过 GitHub Actions 独立发布到 npm。

## 联合开发

首次准备：

```bash
cd /Users/chengcheng/Desktop/ALL/AI/pi-extensions
pnpm install
pnpm build
cd ../pi-webapp
npm install
npm run build
```

两个终端分别运行：

```bash
cd /Users/chengcheng/Desktop/ALL/AI/pi-extensions
pnpm dev
```

```bash
cd /Users/chengcheng/Desktop/ALL/AI/pi-webapp
PI_WEBAPP_PLUGIN_DEV_ROOTS=../pi-extensions/packages/plan-mode npm run start
```

`PI_WEBAPP_PLUGIN_DEV_ROOTS` 接受由系统路径分隔符分开的多个包目录。它显式信任这些本地包，供开发时使用。浏览器 JS/CSS 构建变化后页面自动刷新。Pi 入口构建变化后，后台启动器向空闲 Pi 请求 `/web-dev-reload`；运行中的代理回合结束后再重载，保留当前会话。如果直接用 Pi TUI 运行，则使用 `pi -e ../pi-extensions/packages/plan-mode -e ./dist/extension.js`，修改 Pi 入口后手动 `/reload`。

开发排错：`npm run status` 查看地址，`~/.pi/agent/pi-web/launcher.log` 查看启动器输出；浏览器页面右下角显示插件加载错误数量，`/api/plugins` 在已认证页面中返回具体目录错误。用 `npm run stop` 结束后台服务。改动 pi-webapp 宿主 TypeScript 后仍须 `npm run build` 并重启服务。

验证：

```bash
cd /Users/chengcheng/Desktop/ALL/AI/pi-extensions
pnpm build && pnpm check && pnpm test
cd ../pi-webapp
npm run check && npm test && npm run build
```

计划审批、交互式提问与恢复操作见 [计划模式 README](packages/plan-mode/README.md)。源码版与已安装旧版宿主按扩展路径隔离进程状态，以支持开发热重载。

## 自动发布

仓库为 `chengzhiyi/pi-extensions`，工作流为 `.github/workflows/ci.yml`。
PR 执行类型检查、测试、构建、打包检查及独立目录安装测试；合入 `main` 后，
同样的检查通过才发布。Actions 页面也可手动运行该工作流，重试失败的发布。
`pnpm check` 与 `pnpm test` 会先构建协议包，确保干净检出不依赖残留的 `dist`。
尚未建立 npm 包且没有首次发布凭据时，完整校验仍然执行，发布任务等待初始化，
并在 Actions 警告和摘要中列出待初始化的包。

发布脚本比较当前源码指纹与 npm `latest` 中保存的 `piRelease.fingerprint`：

| 改动 | 发布行为 |
| --- | --- |
| 仅计划插件源码或包内文档变化 | 仅发布计划插件 |
| 协议源码或包内文档变化 | 先发布协议，再发布依赖新协议的计划插件 |
| 仓库级 README、测试、验收产物变化 | 运行检查，不发布 |
| 共享锁文件或依赖配置变化 | 保守地重发两个受影响的包 |

首次发布使用源码版本。之后默认递增补丁版本；如需 minor 或 major，先修改
对应包的 `version`。`workspace:*` 在源码中保留，`pnpm pack` 会将它转换为
本次选定的准确协议版本。包内 README、许可证、构建配置与源码属于指纹输入；
版本和发布回执不属于输入，因此同步版本不会触发循环发布。

发布任务排队串行执行，取得执行机会后检出最新 `main`。所有归档先通过独立
安装验证，再按依赖顺序发布；每次发布都查询 npm 确认版本和指纹。两个包发布
到一半失败、或发布成功后 Git 同步失败时，可重跑工作流：已成功的包会被识别，
无需再发布新版本。成功后通过 `GITHUB_TOKEN` 将包版本、回执和锁文件同步回
`main`；这个令牌产生的推送不会触发新的工作流。

只检查发布计划，不修改文件或发布：

```sh
pnpm release:plan
```

### 首次启用

1. 将代码推送到 `chengzhiyi/pi-extensions`，允许 GitHub Actions 写入 `main`。
   分支规则若禁止机器人直接写入，需要为该工作流配置允许写入的规则。
2. 在 npm 拥有 `@chengzhiyi` scope 下两个包的发布权限。尚未建立的包需先完成
   一次认证发布：可临时在本仓库配置具有创建包权限及绕过 2FA 权限的
   **`NPM_TOKEN` GitHub Actions secret**，手动运行工作流完成首次发布；
   或用下面的命令准备经过验证的归档，再由 npm 登录用户按
   **协议、计划插件**的顺序执行 `npm publish <归档路径> --access public`：

   ```sh
   pnpm install --frozen-lockfile
   pnpm check
   pnpm test
   pnpm build
   pnpm release:prepare
   ```

   `release:prepare` 会更新包版本与回执并将归档放入被忽略的 `artifacts/release/`，
   不执行发布。发布后提交包清单变化，或由后续工作流自动同步。
3. 在两个 npm 包的 Trusted Publisher 设置中分别配置 GitHub 用户
   `chengzhiyi`、仓库 `pi-extensions`、工作流文件名 **`ci.yml`**；不设置
   Environment，并允许直接 `npm publish`。工作流使用 GitHub-hosted runner、
   Node 24、npm 11 和 OIDC，无需保存 npm 发布 token。
   若使用过临时 `NPM_TOKEN`，配置好 Trusted Publishing 后删除它。
4. 在 Actions 中手动运行工作流，或将包改动合入 `main`。

发布归档只包含构建后的 JS/CSS、协议类型声明、包说明及许可证，不包含源码、
source map、测试或截图。`pnpm pack:check` 可在本地执行相同的独立安装验证。

`pi-webapp` 的 CI 会在 `npm ci` 前解析已发布的协议 `latest`，更新为准确版本
并生成对应的 npm 锁文件；宿主发布时将这些变化同步回自己的 `main`。因此协议
必须先公开发布才能发布宿主；初始化之前，宿主校验使用固定提交的协议源码。
后续协议发布不会主动触发另一个仓库的工作流；在 pi-webapp
下一次 PR 或 `main` 构建时解析新协议并检查兼容性。

用户安装已发布的包：

```sh
pi install npm:pi-webapp
pi install npm:@chengzhiyi/pi-plan-mode
```

## 插件生命周期

浏览器入口使用 ES module 默认导出，并声明同步 `activate({ sessionId, signal, onDispose })`。无资源的插件提供 `activate() {}`；监听器、定时器与连接在激活阶段创建并登记同步清理函数，模块顶层只声明定义。宿主先 abort，再逆序清理，组件 effect 单独清理。完整契约和示例见 [协议说明](packages/protocol/README.md#lifecycle-ownership-development-contract-apiversion-remains-1)。

前端断线或会话变化释放前端实例；关闭面板不卸载插件。后端 SDK 实例在切回主 Pi 时保留，真正替换或退出时收到一次关闭事件。断线保留待回答交互，重新连接可以继续。配置变更重新发现插件并重建 SDK 实例，保留会话历史；启动失败保留原实例。

后端 actions 在 `session_start` 注册、在 `session_shutdown` 注销。会话关闭最长等待 5 秒；迟到 action 不落入新实例，已运行的 handler 不做通用取消。诊断包含插件、会话、运行代次和阶段。

当前仍为开发阶段，`apiVersion` 保持 `1`。宿主、协议与插件必须同步构建；旧式全局注册入口不再接入。历史记录格式保持不变，临时执行授权不从历史恢复。
