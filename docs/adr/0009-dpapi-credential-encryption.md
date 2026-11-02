# ADR-0009：连接凭据改用 Windows DPAPI 加密

状态：已采纳。

API Key 等连接凭据原先依赖 Electron `safeStorage`，纯 Node sidecar 中不可用，导致 WinUI 宿主下无法保存凭据（仅有测试专用的 AES 兜底通道）。删除 Electron 宿主（ADR-0008）后必须为 sidecar 提供系统级加密。

## 决策

- 使用 Windows DPAPI（`@primno/dpapi`，CurrentUser 作用域、无附加熵）加密凭据，密文仍以 `SAFE:` 前缀存放于数据目录。`safeStorage` 在 Windows 上的底层即为无附加熵 DPAPI，因此宿主迁移前写入的旧密文可直接解密，无需迁移。
- 解密失败（密文来自其他 Windows 账户/机器，或已损坏）不再静默吞掉：读取凭据时抛出 `CONNECTION_FAILED` 并提示重新保存；更新时重输密钥按旧凭据丢失处理，可直接自愈，无需删除连接重建。
- 移除仅测试环境可用的 `FALL:` AES 兜底与 master key 落盘逻辑，凭据加密只有一条路径。

## 影响

凭据保护边界与 `safeStorage` 一致：防"数据文件被拷走"，不防同一 Windows 账户下的恶意程序。非 Windows 环境无法保存凭据（本应用仅支持 Windows x64）。
