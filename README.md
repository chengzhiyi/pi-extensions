# pi-extensions

Pi 扩展与 pi-webapp 浏览器 UI 的 pnpm 工作区。首批包：

- [`@chengzhiyi/pi-web-protocol`](packages/protocol/README.md)：版本化清单、浏览器贡献声明、会话动作与等待用户决定的交互协议。
- [`@chengzhiyi/pi-plan-mode`](packages/plan-mode/README.md)：Pi 只读计划模式，提供计划徽章、审批卡、交互式提问和文档预览。

要求 Node.js 22.19+、pnpm 10.18.1 和相邻目录中的 `pi-webapp`。根项目保持私有；目前不发布 npm。

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

## 发布顺序

本阶段的 `pi-webapp` 以本地 `file:` 开发依赖引用协议包，其扩展和 Web 产物会打包所需协议运行时代码。**发布 pi-webapp 前**，先在 npm 建立或确认 `@chengzhiyi` scope，发布协议包；将 pi-webapp 中的 `file:` 依赖改为明确版本，并在与 `pi-extensions` 无关的独立检出中完成 `npm ci`、测试和构建。计划模式包随后单独发布。

## 插件生命周期

浏览器入口使用 ES module 默认导出，并声明同步 `activate({ sessionId, signal, onDispose })`。无资源的插件提供 `activate() {}`；监听器、定时器与连接在激活阶段创建并登记同步清理函数，模块顶层只声明定义。宿主先 abort，再逆序清理，组件 effect 单独清理。完整契约和示例见 [协议说明](packages/protocol/README.md#lifecycle-ownership-development-contract-apiversion-remains-1)。

前端断线或会话变化释放前端实例；关闭面板不卸载插件。后端 SDK 实例在切回主 Pi 时保留，真正替换或退出时收到一次关闭事件。断线保留待回答交互，重新连接可以继续。配置变更重新发现插件并重建 SDK 实例，保留会话历史；启动失败保留原实例。

后端 actions 在 `session_start` 注册、在 `session_shutdown` 注销。会话关闭最长等待 5 秒；迟到 action 不落入新实例，已运行的 handler 不做通用取消。诊断包含插件、会话、运行代次和阶段。

当前仍为开发阶段，`apiVersion` 保持 `1`。宿主、协议与插件必须同步构建；旧式全局注册入口不再接入。历史记录格式保持不变，临时执行授权不从历史恢复。
