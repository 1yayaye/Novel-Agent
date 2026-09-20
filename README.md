# Novel Agent by matsuri

本地优先的长篇小说创作工作台。正文、大纲、知识库与创作任务保存在单个 SQLite 文件（`.novelproj`）中；AI 只生成候选草稿，经作者审阅后才写入正文。

## 功能

- 单文件项目管理：导入（UTF-8 / UTF-16 / GB18030）、快照、滚动备份、TXT / Markdown 导出
- CodeMirror 6 编辑器：中文排版、Zen 模式、按章加载
- 大纲与知识库：全书/分章细纲、人物与时间线、一致性提示
- 混合检索：FTS5 中文全文检索，向量检索不可用时自动降级
- AI 流水线：续写、重写、润色、全书问答；外发前预览上下文并确认目标接口
- 差异审阅：字符级对比，按段勾选合并，版本冲突时拒绝覆盖

当前打包目标为 Windows x64 便携版。

## 环境

- Windows 10 / 11（x64）
- Node.js 20.18+（推荐 22 LTS）
- pnpm 9+（仓库锁定 `pnpm@11.21.0`）

```bash
pnpm install
pnpm dev
```

## 常用命令

```bash
pnpm typecheck          # TypeScript 检查
pnpm test               # 单元 / 集成测试
pnpm probe:native       # SQLite 与 sqlite-vec 原生模块
pnpm test:e2e           # Playwright Electron 冒烟测试
pnpm package:portable   # Windows 便携版 .exe
pnpm package:zip        # Windows 绿色 ZIP
pnpm verify             # 发布前全量检查
```

便携版数据写在可执行文件旁的 `data/` 目录。升级时覆盖主程序、保留该目录即可。

## 数据与隐私

- 稿件默认只存在本机 `.novelproj` 中，不上传云端
- 无遥测、无行为追踪
- 模型 API Key 由 Electron `safeStorage` 加密存放
- 首次向某个 API 端点发送正文前会要求确认

请勿把 `dist/`、`data/`、`*.novelproj` 或 `secrets/` 提交到 Git。

## 架构决策

非显而易见的实现约束记录在 `docs/adr/`：

- [0001 分析资产软失效与快照绑定](docs/adr/0001-soft-invalidation-and-report-snapshot-binding.md)
- [0002 两阶段 LCS 差异](docs/adr/0002-two-tier-lcs-diff-optimization.md)
- [0003 共享契约分包与门面](docs/adr/0003-shared-contract-modularization-facade.md)

## 许可证

[MIT](LICENSE)
