# 全书剧情提取与大纲：前端接口

后端入口为 `window.novelAgent.analysis.start({ type: 'book_summary', ... })`。Electron 和 WinUI/WebView2 使用同一份 `NovelAgentApi`；新增方法已接入 preload、共享桥接和服务路由。本文覆盖后端已经实现的行为，前端页面和按钮需要另行接入。

类型定义以 `src/shared/contracts/book-summary.ts`、`src/shared/contracts/ai.ts`、`src/shared/contracts/outline.ts` 和 `src/shared/contracts/index.ts` 为准，可统一从 `src/shared/project.ts` 导入。不要解析 `scopeJson` 或 `checkpointJson` 展示结果，使用 `TaskDetail.bookSummary`。

## 流程与明月的对应

采用参考项目 `E:\小说工作流\明月小说文风蒸馏总结工具\public\summary-prompts.js` 的 13 类完整提示词及栏目要求；将输出容器改为可校验 JSON。小总结、主线、阶段大总结、八类专项资料、首阶段体系判断、超级总结均独立生成并保存。

| 时机 | 步骤顺序 | `kind` |
| --- | --- | --- |
| 每个正文片段 | 小总结 → 更新完整主线 | `small` → `mainline` |
| 达到阶段字数，或最后一个片段结束 | 阶段大总结 → 伏笔 → 角色 → 世界观 → 关系 → 首阶段体系判断 → 体系 → 时间线 → 地点势力 → 未解问题 | `stage` → `foreshadow` → `characters` → `worldview` → `relations` → `systemAssess`（仅一次）→ `system` → `timeline` → `locations` → `unresolved` |
| 全部阶段结束 | 超级总结 → 全书大纲候选 | `super` → `outline` |

每个阶段完成全部专项资料后，才处理下一阶段正文。体系判断为不适用时，每个 `system` 步骤保存带原因的本地产物，并以 `completed` 完成，`notApplicable: true`，不调用模型。

默认片段上限 50,000 字符、阶段阈值 300,000 字符。短章合并，长章优先按段落或句末切开；阶段在完整片段结束后触发，因此可能超过阈值。片段上限还会按模型输入预算缩小。全部导入正文均参与，不抽样、不重叠、不截断；完整滚动资料超出预算时明确失败，不压缩或删减账本。字数和偏移统一为 JavaScript UTF-16 字符单位。

相比旧的 `summary_segment/summary_stage/summary_master` 简化流程，新增独立专项资料和完整栏目，取消滚动状态截断。大纲只整理已经发生的事实，不生成后续剧情预测。独立的章节知识提取、文风蒸馏、报告功能仍使用各自入口。

## 1. 启动任务

```ts
const { taskId } = await window.novelAgent.analysis.start({
  sessionId,
  type: 'book_summary',
  scope: { all: true },
  connectionId,
  instruction: '保留支线与人物动机，区分人物说法和已验证事实。'
})
```

| 参数 | 约定 |
| --- | --- |
| `sessionId` | 当前已打开项目的会话 UUID |
| `type` | 固定 `book_summary` |
| `scope.all` | 传 `true`，分析全部未删除章节；不要传 `chapterIds` |
| `scope.segmentSize` | 可选正整数，默认 50,000；后端可能按预算调小 |
| `scope.stageSize` | 可选正整数，默认 300,000；单位为正文字符数 |
| `connectionId` | 可选生成连接 UUID；省略时使用项目的 `book_summary` 任务路由 |
| `instruction` | 可选补充要求；显式传入时优先于指令预设，包括空字符串 |
| `presetId` | 可选项目指令预设 UUID；未传 `instruction` 时读取其文本 |

返回 `{ taskId }` 只表示任务已创建，不代表模型执行成功。连接目标需要经过现有的联网目标确认；执行失败通过进度与任务详情返回。新任务冻结来源章节、顺序、正文哈希、指令、提示词定义和连接预算。

## 2. 进度与完整结果

使用 `task.onProgress` 订阅 `task:progress`，按 `taskId` 过滤；离开页面时调用返回的解除订阅函数。订阅后主动读取一次任务，避免漏掉订阅前已经完成的步骤。无订阅能力的环境可调用 `analysis.getProgress({ sessionId, taskId })` 轮询。

```ts
const unsubscribe = window.novelAgent.task.onProgress?.(event => {
  if (event.taskId !== taskId) return
  // event.currentStepTitle 可直接显示；收到变化后重新读取 task.get。
})
const task = await window.novelAgent.task.get({ sessionId, taskId })
const result = task.bookSummary
// 页面卸载时 unsubscribe?.()
```

`TaskProgressEvent` 包含 `state`、`totalSteps`、`completedSteps`、`failedSteps`、`percent`、可选的 `currentStepPosition/currentStepKind/currentStepTitle`、累计 `inputTokens/outputTokens` 和 `errorMessage`。当前步骤位置从 0 开始。`percent` 表示步骤完成比例；发布失败时可能已经达到 100%，整体成功必须判断 `state === 'completed'`。这些步骤不绑定单一章节，不能依赖 `currentChapterId` 展示当前步骤。

`task.get` 返回原有 `TaskDetail`，增加可选 `bookSummary`：

```ts
type BookSummaryResult = {
  protocolVersion: 1
  resultState: 'current' | 'stale'
  sources: Array<{
    chapterId: string; title: string; version: number; position: number
    charCount: number; hash: string // 正文 SHA-256
  }>
  totalChars: number
  segmentSize: number // 实际采用的片段上限
  stageSize: number
  stepPlan: Array<{
    stepId: string; kind: BookSummaryStepKind; title: string
    segmentIndex?: number; stageIndex?: number
  }>
  artifacts: BookSummaryArtifact[]
  outlineCandidate: string | null
}

type BookSummaryStepKind =
  | 'small' | 'mainline' | 'stage' | 'foreshadow' | 'characters'
  | 'worldview' | 'relations' | 'systemAssess' | 'system' | 'timeline'
  | 'locations' | 'unresolved' | 'super' | 'outline'

type BookSummaryArtifact = {
  stepId: string; position: number; kind: BookSummaryStepKind; title: string
  segmentIndex?: number; stageIndex?: number // 从 1 开始
  ranges: Array<{ chapterId: string; startOffset: number; endOffset: number }>
  content: string // 完整 Markdown，可展示、复制
  notApplicable: boolean
  graph?: SummaryRelationGraph
  assessment?: SummarySystemAssessment
}
```

`stepPlan` 与 `task.steps` 按位置对应，建议用 `stepId` 关联状态；`artifacts` 仅包含已成功提交的步骤，按执行顺序排列。任务执行中、失败、中断或取消后均可读取已有产物。`outlineCandidate` 在大纲步骤成功前为 `null`；只有整个任务成功且来源仍有效时才允许应用。

`ranges` 使用章节正文的左闭右开偏移，即 `chapter.content.slice(startOffset, endOffset)`；不包含导入文件中已被导入器移除的分章标题和分隔符。小总结和主线记录对应片段，阶段资料记录本阶段覆盖范围，最终总结和大纲记录全书范围。这是产物覆盖范围，不表示模型逐条事实已具有精确引文定位。

正文编辑、新增、删除、改名或排序会使 `resultState` 变为 `stale`。过时产物仍可查看、复制、导出，但不能续跑或应用大纲；应重新创建任务。旧版任务不转换检查点，可能没有 `bookSummary`，前端应提示重新发起。

### 角色关系图与体系判断

```ts
type SummaryRelationGraph = {
  nodes: Array<{ id: string; name: string; role: string; weight: number }>
  edges: Array<{
    source: string; target: string; label: string
    type: 'ally' | 'enemy' | 'family' | 'romance' | 'mentor'
      | 'business' | 'faction' | 'conflict' | 'neutral' | 'unknown'
    strength: number
  }>
}
type SummarySystemAssessment = {
  applicable: boolean; label: string; reason: string; fields: string[]
}
```

关系产物同时提供完整文字与结构化 `graph`；节点 ID 唯一，连线端点必须存在。`weight` 范围 1–5，`strength` 为 1–5 整数。体系判断提供 `assessment`，前端使用其布尔值判断适用性，不从文字匹配“处理/不处理”。

## 3. 暂停、恢复、重试与取消

| 调用 | 适用状态与行为 | 返回 |
| --- | --- | --- |
| `analysis.pause({ sessionId, taskId })` | 排队或运行时暂停，状态为 `interrupted`，保留已提交产物 | `{ success: true }` |
| `analysis.resume({ sessionId, taskId })` | `interrupted` 或 `failed`，从未成功提交的步骤继续 | `{ taskId }` |
| `task.retry({ sessionId, taskId })` | 重试失败任务；全部模型步骤成功而发布失败时，仅重做发布 | `TaskSummary` |
| `task.retryStep({ sessionId, taskId, stepId })` | 重试失败步骤，并顺序继续后续步骤 | `TaskSummary` |
| `analysis.cancel({ sessionId, taskId })` | 用于排队或运行的任务；取消后保留产物，不能恢复 | `{ success: true }` |
| `task.list({ sessionId, type: 'book_summary' })` | 重新打开项目后找回任务；运行中崩溃的任务恢复为 `interrupted` | `TaskSummary[]` |

本流程禁止 `task.skipStep`。暂停或取消时，尚未提交的响应不会成为产物；恢复可能重新请求该步骤。成功提交的步骤不会再次调用模型。结构化输出沿用网关的格式修复与网络重试；这些重试可能产生额外模型调用，产物和步骤计数仍为一次。

任何必需步骤失败都会停止整个流程，不使用旧资料冒充该步骤成功。恢复前会校验来源、提示词快照和连接预算；修改这些内容后需创建新任务。取消确认以任务详情或后续进度为准，接口返回不表示远端服务已经停止计费。

## 4. 梗概与大纲发布

全部步骤完成后，在同一数据库事务中发布超级总结为当前全书梗概，并标记任务 `completed`。现有 `synopsis.get({ sessionId })` 可读取梗概。

全书大纲不存在时，自动保存候选为 `draft`；已经存在任何大纲时，保留原稿，候选留在 `bookSummary.outlineCandidate`。前端读取现有大纲后展示比较，由作者选择是否替换：

```ts
const current = await window.novelAgent.outline.getBookOutline({ sessionId })
// 展示 current?.content 与 task.bookSummary?.outlineCandidate 的比较。
// 作者选择应用后，使用这次比较时看到的版本：
const draft = await window.novelAgent.analysis.applyOutline({
  sessionId, taskId, expectedVersion: current?.version ?? 0
})
// draft 为 BookOutline；如需确认，另走现有 outline.confirmBookOutline。
```

`expectedVersion` 必填：`0` 表示预期当前没有大纲，正整数表示预期版本。冲突返回 `VERSION_CONFLICT`，应重新读取并让作者比较，不能自动取新版本后覆盖。成功返回 `BookOutline`，`state: 'draft'`，`sourceVersions` 记录来源章节版本。确认仍需调用 `outline.confirmBookOutline({ sessionId, expectedVersion: draft.version })`。

来源变化会将本流程发布的梗概，以及内容仍与本流程候选一致的大纲标为过时；作者已经改写的大纲由作者维护。本流程不写入章节摘要、知识建议、设定库或一致性问题。

## 5. 导出

```ts
const exported = await window.novelAgent.analysis.exportSummary({ sessionId, taskId })
// 打开原生 Markdown 保存对话框；取消返回 null。
// 成功返回 { savedPath: string }。
```

可选 `destination` 为绝对文件路径，用于已有明确保存位置的调用；父目录必须存在。结果包含来源、步骤状态及全部已提交产物、关系图、体系判断和覆盖坐标。中断、失败、取消或过时任务也可导出；导出不触发模型调用，也不改变资料状态。

## 6. 错误处理

同步失败会拒绝 Promise，错误保留 `code/message`；异步执行失败保存到 `TaskDetail.errorCode/errorMessage`，进度事件只带 `errorMessage`。

| `code` | 前端处理 |
| --- | --- |
| `VALIDATION_ERROR` | 检查正文、整本范围、预设和导出路径 |
| `CONNECTION_NOT_FOUND` | 选择生成连接或设置 `book_summary` 路由 |
| `CONTENT_TARGET_CONFIRMATION_REQUIRED` | 使用现有连接目标确认界面，再恢复任务 |
| `MODEL_CONTEXT_EXCEEDED` | 完整输入超预算；调整连接预算或分段后新建任务，不提示跳过 |
| `MODEL_OUTPUT_INVALID` | 展示失败步骤与原因，允许重试；空结果、结构错误、无效关系图、输出被截断均不能算成功 |
| `STALE_CONTEXT_PACKAGE` | 来源或冻结配置变化，保留查看/导出，要求新建任务 |
| `VERSION_CONFLICT` | 重新读取大纲并展示比较，不静默覆盖 |
| `INVALID_STATE_TRANSITION` | 刷新任务状态；全书总结不可跳过步骤 |
| `AUTH_FAILED` / `CONNECTION_FAILED` / `RATE_LIMITED` | 沿用现有连接错误提示与重试入口 |
| `EXPORT_FAILED` | 提示更换路径或检查文件占用，保留任务产物 |

## 7. 现有前端待接入位置

- `src/renderer/features/workbench/WorkbenchLayout.tsx` 的“一键提取剧情与大纲”入口目前仍传 `initialType: 'knowledge'`，应改为 `book_summary`；独立知识提取入口继续使用 `knowledge`。
- `StartAnalysisDialog.tsx` 的全书总结模式固定整本范围；移除该模式的章节勾选。当前阶段默认值及兜底值为 `1000000`，全书总结应改为 `300000` 或省略让后端取默认值，不影响文风蒸馏的配置。
- 任务详情通过 `stepPlan` 展示全部步骤，通过 `artifacts` 展示完整资料；提供关系图、复制、导出、候选比较及应用入口，禁用本流程的跳过操作。
- 工作流引导完成条件应读取成功且来源有效的 `book_summary` 任务或梗概；本流程不生成 `chapter_summary`，不能继续用章节摘要数量判断提取完成。

按本次范围只交付后端与接口，以上页面尚未调整。
