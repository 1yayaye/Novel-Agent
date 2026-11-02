# Novel Agent 文档中心 (Documentation Hub)

本文档中心归档了 Novel Agent 本地长篇小说创作工作台的核心设计规范、架构决策、真实模型端到端评测报告与实施计划。

---

## 目录结构索引

```text
docs/
├── README.md                              # 本索引文件
├── book-summary-api.md                    # 全书总结与大纲生成 API 规范与数据契约
├── preset-conversion-api.md               # 酒馆预设转换规范 (API & 模式 B 架构)
├── frontend-architecture.md               # 前端渲染层架构 (React 19 + Tailwind v4 + Zustand)
├── project-compatibility-and-capabilities.md # 项目版本兼容与能力契约
├── gemini-review.md                       # Gemini 架构评审建议与基准对齐
│
├── adr/                                   # 架构决策记录 (Architecture Decision Records)
│   ├── 0001-soft-invalidation-and-report-snapshot-binding.md
│   ├── 0002-two-tier-lcs-diff-optimization.md
│   ├── 0003-shared-contract-modularization-facade.md
│   ├── 0004-frontend-refactor-stack-and-state-architecture.md
│   ├── 0005-renderer-component-and-workspace-interaction-hierarchy.md
│   ├── 0006-visual-direction-and-renderer-reconstruction.md
│   ├── 0007-mingyue-book-summary.md
│   └── 0008-preset-tool-calling-from-declaration.md
│
├── reports/                               # 真实环境运行、基准评测与验收报告
│   ├── dual-project-comparison-report.md      # 双项目真实流程与深度对照分析报告 (2026-10-18)
│   ├── mode-b-real-execution-report.md        # 模式 B 两阶段转换与正文续写实测报告 (2026-10-12)
│   ├── acceptance-preset-fidelity-report.md   # 酒馆预设保真导入与装配验收报告 (2026-10-16)
│   └── general-tavern-preset-compatibility-report.md # 酒馆预设通用兼容与交错输出报告
│
├── plans/                                 # 实施路线与演进计划
│   ├── book-summary-frontend-plan.md          # 全书剧情提取与大纲前端任务实施计划
│   ├── frontend-ui-adoption-plan.md           # 前端 UI 与温润拿铁视觉落地计划
│   └── rolling-analysis-execution-plan.md     # 滚动知识分析执行计划
│
└── agents/                                # 智能体开发规范与协作标准
    ├── domain.md                              # 领域概念与名词契约
    ├── issue-tracker.md                       # GitHub Issue 跟踪规范
    └── triage-labels.md                       # 分流标签规范
```

---

## 一、 规范与设计契约 (Specifications & Contracts)

| 文档 | 核心说明 | 适用场景 |
| :--- | :--- | :--- |
| [`book-summary-api.md`](./book-summary-api.md) | 全书蒸馏、主线滚动追踪、8 类专项资料生成、体系自适应研判与大纲生成的全量协议与 IPC 接口规范 | 全书总结后端流水线与前端看板接入 |
| [`preset-conversion-api.md`](./preset-conversion-api.md) | 酒馆 (SillyTavern) 预设两阶段 AI 转换规范，本地零 Token 预清洗与写时复制静态适配架构 | 酒馆预设导入与提示词工坊维护 |
| [`frontend-architecture.md`](./frontend-architecture.md) | React 19 + Tailwind v4 + Zustand 领域切片架构，温润拿铁（Warm Latte）卡片叙事流与 Action Dock | 前端组件开发与交互模型扩展 |
| [`project-compatibility-and-capabilities.md`](./project-compatibility-and-capabilities.md) | 项目 schema_version 校验规则、只读保护与能力契约（`OpenProjectResult.capabilities`） | 项目存储管理与多版本隔离 |
| [`gemini-review.md`](./gemini-review.md) | Gemini 针对架构设计、模块深度与代码整洁度的评审报告与整改清单 | 架构审查与基准对齐 |

---

## 二、 架构决策记录 (ADRs)

非显而易见的实现约束与架构权衡详见 [`docs/adr/`](./adr/)：

1. [ADR-0001: 分析资产软失效与快照绑定](./adr/0001-soft-invalidation-and-report-snapshot-binding.md)
2. [ADR-0002: 两阶段 LCS 差异](./adr/0002-two-tier-lcs-diff-optimization.md)
3. [ADR-0003: 共享契约分包与门面](./adr/0003-shared-contract-modularization-facade.md)
4. [ADR-0004: 前端重构架构与状态流解耦 (React 19 + Tailwind v4 + Zustand)](./adr/0004-frontend-refactor-stack-and-state-architecture.md)
5. [ADR-0005: 渲染层组件体系与工作台交互分层 (Appica UI + drawers)](./adr/0005-renderer-component-and-workspace-interaction-hierarchy.md)
6. [ADR-0006: 视觉设计语言与领域切片重塑 (温润拿铁与故事节拍流)](./adr/0006-visual-direction-and-renderer-reconstruction.md)
7. [ADR-0007: 以完整明月流程实现全书剧情提取](./adr/0007-mingyue-book-summary.md)
8. [ADR-0008: 预设工具调用 schema 由导入器从预设声明解析](./adr/0008-preset-tool-calling-from-declaration.md)

---

## 三、 实测与验收报告 (Reports & Benchmarks)

真实接入 Google Gemini 3.7 Flash、真实酒馆预设与真实长篇小说的审计报告归档于 [`docs/reports/`](./reports/)：

1. **[双项目真实流程与深度对照分析报告](./reports/dual-project-comparison-report.md)** (2026-10-19)
   - **测试对象**：原版明月小说文风蒸馏工具（Project A） vs Novel Agent 工作台（Project B）。
   - **实测样本**：《我的妻子成了公司高层的公用奶牛》（12 章，42,692 字），模型 `build-gemini-3.7-flash`。
   - **核心结论**：在真实涉黄小说遭遇上游 NSFW 内容审查拦截时，Project A 崩溃闪退、状态全丢；Project B 依托 SQLite 事务回滚与错误隔离实现故障精准隔离，全流程 16 步指标与结构化 JSON 契约全面领先。
   - **审计数据**：`test-results/dual-project-comparison/2026-10-18T19-28-22-139Z/`。

2. **[模式 B 两阶段转换与正文续写实测报告](./reports/mode-b-real-execution-report.md)** (2026-10-12)
   - **测试对象**：`Izumi 1002.json`（264 条源预设）+ 《妈妈的末日修仙》（37 章末尾草地哭泣场景）。
   - **核心结论**：重构后的两阶段转换将 200+ 批次请求缩减至 2 批（88.9 秒完成），续写生成 4,703 字 100% 纯净正文，无任何 RP 标签污染。
   - **审计数据**：`test-results/real-execution/2026-10-12T21-16-20-992Z_modeB/traces/`。

3. **[酒馆预设保真导入与装配最终验收报告](./reports/acceptance-preset-fidelity-report.md)** (2026-10-16)
   - **测试对象**：标准 12 项拓扑预设及 4 个社区复杂预设（Izumi 1002、狐神抚、智脑-Z、Kemini Dramatron）。
   - **核心结论**：虚假插槽注入率降为 0%，100% 还原源 `prompts` 与 `prompt_order`，Post-History 近因效应与 In-Chat 穿插全部通过验收。

4. **[酒馆预设通用兼容与交错输出报告](./reports/general-tavern-preset-compatibility-report.md)** (2026-10-12)
   - **核心结论**：标准 `{{setvar}}` / `{{getvar}}` 展开、注释与控制宏清洗、`<Interleaving>` 交错思考净化，73 个测试套件 418 项测试 100% 通过。

---

## 四、 实施计划 (Implementation Plans)

正在推进或已落地的特性实施计划归档于 [`docs/plans/`](./plans/)：

- [`book-summary-frontend-plan.md`](./plans/book-summary-frontend-plan.md)：全书剧情提取与大纲前端任务实施计划（四步接入：入口对齐、参数固定、成果看板与冷启动指引）。
- [`frontend-ui-adoption-plan.md`](./plans/frontend-ui-adoption-plan.md)：前端 UI 与温润拿铁视觉体系落地计划。
- [`rolling-analysis-execution-plan.md`](./plans/rolling-analysis-execution-plan.md)：滚动知识分析流水线执行计划。

---

## 五、 智能体开发规范 (Agent Guidelines)

智能体协同开发、领域术语与 Issue 管理规范详见 [`docs/agents/`](./agents/)：

- [`domain.md`](./agents/domain.md)：核心领域概念与词汇表维护规则。
- [`issue-tracker.md`](./agents/issue-tracker.md)：基于 `gh` CLI 的 GitHub Issue 跟踪流程。
- [`triage-labels.md`](./agents/triage-labels.md)：五大标准化分流标签定义。
