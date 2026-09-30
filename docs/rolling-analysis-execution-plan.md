# 连贯小说滚动分析

## 目标

修复当前“知识设定与一致性”按章独立请求造成的上下文断裂，并让“故事梗概”沿用同一套连续语境。

完成后，处理第 N 章时模型能够看到前文已经确认的主线、角色状态、世界观、时间线、伏笔和未解问题；第 N 章只提交增量，随后更新滚动状态供第 N+1 章使用。现有章节摘要、知识建议、一致性问题、语义分块和全书梗概仍然可用，文学六维报告保持现状。

## 范围

范围：

- `knowledge` 分析任务：按章节顺序串行处理，增加滚动上下文。
- `synopsis` 分析任务：按摘要顺序逐段更新主线，最后生成全书梗概。
- 自动生成的全书梗概：使用本次知识任务的最终滚动状态做一次最终汇总，不把末章状态回放成第一章上下文。
- 使用现有 `task_step.checkpoint_json` 保存和恢复滚动状态。

- 文风蒸馏和全书总结属于正式流水线；阶段合并保持片段原文顺序。
- 文学六维 `report`、语义分块和证据 offset 规则保持兼容。
- 分析结果导出由当前 schema 的项目能力控制。

## 固定实现决策

### 1. 滚动状态结构

在 `src/main/analysis-runner.ts` 内定义私有类型和默认值，不把它提升为公共契约：

```ts
type RollingAnalysisState = {
  mainline: string
  characters: string
  world: string
  relations: string
  timeline: string
  foreshadowing: string
  unresolved: string
}
```

状态只保存模型可继续使用的资料，不保存原文全文。每个字段设置统一字符上限；超限时要求模型压缩旧内容并保留未解决项、已确认事实和后文需要追踪的变化。默认上限使用现有连接上下文窗口可安全容纳的规模，具体计算方式沿用项目现有 token 估算，不新增配置项。

### 2. Knowledge 请求流程

修改 `AnalysisRunner.runTask` 的 `knowledge` 分支：

1. 保持 `task.steps` 的章节顺序和现有章节级提交逻辑。
2. 在进入步骤前读取最近一个已完成步骤的 `checkpointJson`；没有则使用空状态。
3. 请求内容同时包含：
   - 当前章节标题和完整正文；
   - 前文滚动状态；
   - 明确要求按原文顺序分析，只输出当前章节新增或变化内容。
4. 扩展当前内部 Zod 输出结构，增加可选 `rollingState` 字段，字段形状与 `RollingAnalysisState` 一致；旧模型未返回时使用输入状态加当前摘要的安全回退值。
5. 继续把 `summary`、`semanticChunks`、`suggestions`、`consistencyIssues` 交给现有 `commitChapterAnalysis`，不改变证据 offset 校验。
6. 章节提交成功后，把规范化后的滚动状态写入当前步骤 `checkpointJson`，并将步骤标记为 `completed` / `current`。
7. 下一章节只读取已完成步骤的 checkpoint，不重新拼接所有历史正文。

系统提示词必须明确以下规则：

- 前文状态是已知上下文，当前章节是唯一需要提取增量的正文。
- 不把猜测、谎言、伪装或未验证说法写成已确认事实。
- 保留跨章因果、角色状态变化、时间先后、伏笔回收和未解问题。
- 当前章节没有变化时明确写“无新增”，不要重写整份资料。

### 3. 任务恢复与失败处理

- `resumeTask`：沿用现有 pending/running 状态恢复逻辑；知识步骤从最近已完成 checkpoint 继续。
- 当前步骤请求失败：步骤保持现有失败状态，不写入新的 checkpoint。
- 重试失败步骤：先使用它之前最近的已完成 checkpoint；不读取该失败步骤的旧 checkpoint。
- 跳过失败步骤：滚动状态保持上一已完成 checkpoint，后续步骤继续执行，并在提示词中标明中间章节被跳过。
- 不修改任务表和步骤表结构。

### 4. Synopsis 请求流程

修改 `synopsis` 分支及 knowledge 完成后的自动梗概生成：

- 不再只把章节摘要无状态拼接后请求一次。
- 按章节 position 顺序逐段处理，每一段请求包含：上一版主线、当前章节摘要、当前章节标题，以及必要的角色/伏笔/时间线状态。
- 每次请求返回更新后的主线和结构化梗概文本；循环结束后再生成现有 `book_synopsis.summary`。
- 版本记录仍使用现有 `source_versions_json`，提交仍调用 `commitBookSynopsis`。
- knowledge 任务自动生成梗概时，使用本次任务最终 checkpoint 和本次产生的章节摘要；不会把最终状态重新套到第一章。

为避免长篇小说请求无限增长，主线状态只传递压缩后的滚动资料，不把前面所有摘要重复放入每次请求。

### 5. 全书总结与文风蒸馏

- `book_summary` 每个片段请求携带前一片段状态，checkpoint 保存片段状态；阶段合并继续区分事实和推测。
- `style_distill` 片段独立提炼，阶段按原文顺序合并；失败或跳过片段不会伪造成功 checkpoint。
- rolling state 超限先请求结构化压缩，压缩失败使用字段级确定性裁剪。

### 6. 现有 UI 和报告行为

- `StartAnalysisDialog`、`ConnectionDialog`、`CreativeSettingsDialog` 和任务中心按项目能力隐藏新增流水线。
- 任务中心继续显示现有章节步骤和 token 统计。
- `report` 分支保持原实现。
- `generateBookOutlineDraft` 保持原接口；若使用章节摘要，继续从现有 `chapter_summary` 读取。

## 修改文件

主要修改：

- `src/main/analysis-runner.ts`
  - 增加滚动状态类型、默认值、checkpoint 读取和长度压缩辅助函数。
  - 修改 knowledge 请求上下文、结构化输出和 checkpoint 写入。
  - 修改 synopsis 的顺序滚动调用。
  - 保持 report、章节结果提交和版本门禁逻辑不变。
- `src/renderer/components/dialogs/StartAnalysisDialog.tsx`
  - 仅更新知识分析说明文案，明确“按顺序滚动分析”。
- `tests/analysis-runner.test.ts`
  - 增加连续上下文和恢复场景测试；复用现有本地 HTTP mock、ProjectStore 和 ModelGateway。

- 保留 `0005_analysis_pipelines.sql` 作为新项目初始化和离线工具脚本；桌面端打开项目不自动执行迁移。
- shared contract 正式包含新增任务类型、能力字段、暂停和分析导出选项。

## 执行顺序

1. 读取 `analysis-runner.ts` 当前 `knowledge`、`synopsis`、任务恢复和错误处理路径，保留现有提交门禁。
2. 增加滚动状态的最小内部实现和序列化/反序列化容错：非法 checkpoint 视为空状态，不阻塞任务。
3. 修改 knowledge 提示词和输出 schema，先完成单章摘要/建议/问题提交，再持久化 checkpoint。
4. 修改 synopsis 顺序处理，接入同一套状态压缩规则。
5. 更新知识分析入口文案，不改变 UI 交互。
6. 增加测试并运行相关测试、类型检查。
7. 检查 diff，删除未使用 import、调试代码和不必要的辅助函数。

## 验收标准

### 必须通过

- 两章知识分析中，第二次模型请求的请求体包含第一章生成的滚动主线或已确认事实。
- 第二章输出能够引用第一章建立的角色/设定，并只提交第二章新增变化。
- 每个章节仍生成原有 `chapter_summary`，建议和一致性问题仍按原章节保存，证据 offset 校验继续生效。
- 任务中断后恢复，后续步骤从最近完成 checkpoint 继续，而不是从空上下文开始。
- 失败步骤重试不会使用该失败步骤的旧 checkpoint；跳过步骤不会清空已有滚动状态。
- 多章 synopsis 请求按章节顺序携带上一轮主线，最终仍只写入一个现有 `book_synopsis` 结果。
- 单章任务、旧项目无 checkpoint、无章节摘要等情况不抛出未处理异常。
- `report` 行为和现有六维输出不变。
- 旧 schema 项目打开不写库、不备份、不迁移，并返回 `legacy_schema` 只读能力。
- 旧项目仍可读取、编辑保护和导出正文；分析流水线及附加分析导出明确拒绝。

### 验证命令

```powershell
pnpm test -- tests/analysis-runner.test.ts
pnpm typecheck
```

若针对实现新增的测试无法使用精确测试路径运行，则运行：

```powershell
pnpm test
```

## 最小测试场景

1. **连续上下文主路径**：创建两章，mock 第一次响应滚动状态；断言第二次请求包含该状态，任务完成后两章摘要和最终梗概均存在。
2. **恢复路径**：预置第一步完成且带 checkpoint、第二步 pending 的任务；恢复任务，断言第二步请求使用预置 checkpoint。
3. **关键失败路径**：让第二步第一次请求失败后重试；断言重试请求使用第一步 checkpoint，且不会读取失败响应生成的状态。

## 完成定义

只有同时满足以下条件，才报告完成：

- 代码修改已落盘且 diff 只覆盖本计划范围。
- 上述必须通过验收点全部验证。
- 相关测试和 `pnpm typecheck` 通过；无法运行时如实报告具体原因和已完成的替代检查。
- 没有遗留临时文件、调试输出或未使用代码。
