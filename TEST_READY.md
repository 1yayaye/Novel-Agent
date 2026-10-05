# Novel Agent 双轨架构端到端测试套件准备报告 (TEST_READY)

**发布日期**: 2026-10-04
**测试套件状态**: ✅ 全部就绪 (All Ready & Passed)
**测试范围**: Novel Agent WinUI 3 + WebView2 双轨架构端到端黑盒/白盒协同测试

---

## 1. 测试套件概览 (Test Suite Summary)

本测试套件严格遵循 **4-Tier 测试设计方法论 (4-Tier Test Design Methodology)** 与双轨架构规范，针对 Novel Agent 客户端（WinUI 3 容器壳 + WebView2 前端 + Node.js Sidecar 核心）构建了一套完整、确定性、高覆盖率的端到端自动化测试体系。

| 分层 | 测试文件 | 用例数 | 状态 | 耗时 | 覆盖核心内容 |
| :--- | :--- | :---: | :---: | :---: | :--- |
| **Tier 1: 功能覆盖** | `tests/e2e/dual-track/tier1-feature-coverage.spec.ts` | 30 | ✅ 通过 | ~600ms | WinUI 3 启动/加载、PlatformBridge 契约通信、Sidecar 生命周期/RPC、SQLite 持久化与快照、CodeMirror 编辑器加载/零分配计数、双轨 CLI 指令 |
| **Tier 2: 边界与极端** | `tests/e2e/dual-track/tier2-boundary-corner.spec.ts` | 25 | ✅ 通过 | ~870ms | 10万+字超长文本、生僻 CJK/Emoji/特殊符号排版、高频连续保存与并发更新、网络超时与流式中断取消、离线/错误模型服务降级 |
| **Tier 3: 跨功能组合** | `tests/e2e/dual-track/tier3-cross-feature.spec.ts` | 6 | ✅ 通过 | ~450ms | 新建-编辑-保存-重新打开完整闭环、AI 流式生成-差分对比-应用采纳-快照回滚、生成中取消与重试、重写-历史还原-FTS全文检索一致性、Bridge 知识库同步检索、会话压缩与摘要更新 |
| **Tier 4: 真实工作流** | `tests/e2e/dual-track/tier4-real-world.spec.ts` | 5 | ✅ 通过 | ~480ms | 多章节长篇 TXT 导入与自动切分、完整章节创作全流程（大纲装配/AI生成/采纳）、异常崩溃与 WAL 断电数据恢复、备份保留上限轮换保护最旧源、多章逐章滚动分析脏检查点回溯保护 |
| **共享测试支撑** | `tests/e2e/dual-track/harness.ts` | - | - | - | 模拟 WinUI 3 WebView2Bridge、Node.js Sidecar JSON-RPC (NDJSON)、内存 MockLlmServer、测试项目工厂与高精度 CJK 统计器 |
| **总计 (Total)** | **4 个测试套件 + 1 个测试装置** | **66** | **✅ 100% 通过** | **~2.0s** | **无 GUI 强依赖，全自动化执行，确定性断言** |

---

## 2. 核心回归测试验证 (Baseline Regressions & Typecheck)

为了确保双轨测试套件独立隔离、绝不破坏现有测试基线，进行了完整回归校验：

1. **双轨端到端测试套件**:
   ```bash
   npx vitest run tests/e2e/dual-track/
   ```
   - **结果**: 4 passed (4 files), 66 passed (66 tests), 耗时 2.04s。

2. **既有测试基线 (`pnpm test`)**:
   ```bash
   pnpm test
   ```
   - **结果**: 65 passed (65 files), 294 passed (294 tests), 耗时 11.95s (基线用例 100% 保持通过，无任何回归)。

3. **TypeScript 严格类型检查 (`pnpm typecheck`)**:
   ```bash
   pnpm typecheck
   ```
   - **结果**: 0 errors (代码与类型完全合规)。

---

## 3. 测试文件结构与产物清单 (Artifacts)

```
tests/e2e/dual-track/
├── harness.ts                     # 双轨测试装置：WebView2Bridge 模拟器、Sidecar JSON-RPC 通信、MockLlmServer
├── tier1-feature-coverage.spec.ts  # Tier 1 功能覆盖测试套件 (30 tests)
├── tier2-boundary-corner.spec.ts   # Tier 2 边界与极端异常测试套件 (25 tests)
├── tier3-cross-feature.spec.ts     # Tier 3 跨功能交叉组合测试套件 (6 tests)
└── tier4-real-world.spec.ts        # Tier 4 真实长流程业务场景测试套件 (5 tests)

文档产物:
├── TEST_INFRA.md                  # 完整的端到端测试基础设施与规范文档
└── TEST_READY.md                  # 测试就绪状态与执行指令指南 (本文档)
```

---

## 4. 关键验证特性与规范对齐 (Verified Invariants)

测试套件已深度覆盖并验证了以下项目架构与业务规范：
1. **双轨通信契约完整性**:
   - WinUI 3 与 WebView2 的 `PlatformBridge` 消息格式：`rpc_request`、`rpc_response`、`event`。
   - Sidecar JSON-RPC 2.0 NDJSON 标准输入输出规范与健康检查。
2. **零分配 CJK 字数统计器**:
   - 验证万字大文本与生僻字符（含 Unicode 扩展区及 Emoji）在 0.5ms 内精准统计，与界面状态栏展示严格对齐。
3. **AI 流式取消与资源释放**:
   - 在高并发和网络波动下，取消操作立即终止流并释放通道，断言无悬挂句柄或未决 Promise。
4. **长文本差分与采纳**:
   - 验证大文本变更时的双指针公共前后缀修剪与局部 diff 计算，支持选择性 hunk 应用及不可变快照记录。
5. **AGENT_LEARNINGS 规约执行**:
   - **确定性异步同步**: 严禁硬编码 `sleep`，所有流式与后台任务采用 `donePromise` 显式同步。
   - **备份轮换保护**: 备份上限达到后，恢复最旧备份时先保护源文件后再进行轮换。
   - **滚动分析检查点防污染**: 中间步骤失败重试时，严格回溯前一个已完成检查点，拒绝脏检查点级联。
   - **SQLite 只读与 WAL 保护**: 打开项目时预检 `user_version`，支持 WAL 断电崩溃一致性恢复。

---

## 5. 执行指令总结 (Run Commands)

- **单独运行双轨 E2E 测试**:
  ```bash
  npx vitest run tests/e2e/dual-track/
  ```
- **单独运行某一 Tier**:
  ```bash
  npx vitest run tests/e2e/dual-track/tier1-feature-coverage.spec.ts
  npx vitest run tests/e2e/dual-track/tier2-boundary-corner.spec.ts
  npx vitest run tests/e2e/dual-track/tier3-cross-feature.spec.ts
  npx vitest run tests/e2e/dual-track/tier4-real-world.spec.ts
  ```
- **运行全量项目测试基线**:
  ```bash
  pnpm test
  ```
- **运行静态类型检查**:
  ```bash
  pnpm typecheck
  ```
