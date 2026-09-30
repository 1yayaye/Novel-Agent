# 项目版本兼容与功能能力

## 版本规则

当前 schema 版本由 `project_meta.schema_version` 和 SQLite `user_version` 共同标识。新建项目直接创建当前 schema、分析流水线表、默认预设和任务路由。

桌面端打开旧项目时不执行迁移、不创建备份、不写入业务数据，也不提供升级按钮或升级 IPC。低于当前 schema 的项目永久以只读模式打开，仅保留旧章节读取、旧编辑保护和正文导出能力。打开结果使用 `readOnlyReason: "legacy_schema"`，不使用 `future_schema` 混淆表示。

`src/main/migrations/0005_analysis_pipelines.sql` 保留给新项目初始化和未来离线工具，不能由桌面端 `open()` 自动调用。

## 能力契约

`OpenProjectResult.capabilities` 是稳定的共享契约：

- `analysisPipelines`：可启动知识分析、文风蒸馏、全书总结和相关任务控制。
- `analysisExport`：导出全书总结、已保存文风样本和章节正文。
- `taskControls`：暂停、恢复、重试和跳过分析步骤。

旧项目三个能力均为 `false`。当前 schema 的只读项目仍可导出已有分析结果，但不能创建或控制新任务；正文导出始终保留，`includeAnalysis` 不具备能力时被禁用或返回 `UNSUPPORTED_SCHEMA`。

## 行为边界

新增任务类型 `style_distill` 和 `book_summary`、分析暂停/恢复/重试、滚动知识分析、全书总结和分析附加导出只对支持流水线的当前 schema 项目开放。前端按能力隐藏或禁用入口，主进程在任务、路由、预设和导出入口再次校验能力。

升级旧项目的唯一方式是新建项目并重新导入正文；产品不提供原地升级操作。
