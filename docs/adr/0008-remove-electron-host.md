# ADR-0008：移除 Electron 宿主，只保留 WinUI 宿主

状态：已采纳。

项目曾采用"双轨"架构：同一份 React 渲染层与后端服务层，由 Electron 与 WinUI 3 + WebView2 两个宿主分别承载。双轨期的唯一功能性差异是凭据加密（Electron `safeStorage`）；该差异已由 Windows DPAPI 方案补齐（见 ADR-0009）。维持两个宿主意味着两套打包链、两套 E2E 与双倍验证面，而 Electron 侧不再提供任何独有能力。

## 决策

- 删除 Electron 宿主及其全部痕迹：主进程入口、`src/preload`、platform-bridge 的 Electron transport 分支、`electron`/`electron-vite`/`electron-builder` 依赖、electron-builder 配置块与相关脚本、Playwright Electron E2E。
- 渲染层构建改用普通 Vite 配置（产物仍为 `out/renderer`）；后端 sidecar 与原生探针用 esbuild 打成单文件 CJS（`out/main/sidecar.cjs`、`out/main/probe.cjs`），由 `scripts/build.mjs` 统一编排。SQL 迁移沿用 Vite `?raw` 约定，由 esbuild 插件内联。
- 原生探针改为纯 Node 运行，不再依赖 Electron 二进制。
- 服务层集成冒烟由 dual-track 测试（WebView2 桥模拟器 + sidecar JSON-RPC 模拟器跑真实服务）承担，并入默认 `pnpm test`；WebView2 真机 E2E 另行立项。
- 打包维持 `pnpm winui:package` 便携 ZIP；不捆绑 node.exe，要求目标机器 PATH 中有 Node.js（已知限制，SidecarSupervisor 已支持捆绑形态）。

## 影响

仓库不再能产出 Electron 便携版；恢复需要回退本次提交。打包产物体积从带 Chromium 的便携 exe 变为 WinUI + 渲染层 + sidecar 资产的 ZIP，且目标机器需预装 Node.js。数据文件（`.novelproj`、`connections.json`、`data/` 布局）不受影响，无需迁移。
