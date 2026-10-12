# 预设转换后端接口

本文对应 `src/shared/preset-conversion.ts` 的契约和 `src/main/preset-conversion.ts` 的实现。转换流程已经接入 Electron 预加载桥、共享平台桥和 WinUI Sidecar；本次没有实现导入界面。

酒馆预设经过来源解析、完整内容分批分析、摘要整合、静态转换和编译校验，返回待确认的预设及兼容报告。开始转换会调用模型，读取结果不会保存或启用预设；调用方确认后使用已有预设库接口保存。

## 调用入口

桌面桥入口为 `window.novelAgent.prompt`，每个方法返回 Promise；失败时抛出具有 `code` 和 `message` 的错误。共享 `NovelAgentApi` 的契约相同。

| 方法 / IPC 通道 | 入参 | 返回值 | 行为 |
| --- | --- | --- | --- |
| `prompt.inspectPresetConversion` | `PresetConversionInput` | `PresetConversionInspection` | 本地检查格式、来源清单和批次估算，不调用模型、不保存原文件 |
| `prompt.startPresetConversion` | `PresetConversionInput` | `{ taskId: string }` | 保存原文件并创建异步任务；酒馆格式需要生成模型 |
| `prompt.getPresetConversionStatus` | `{ taskId: string }` | `PresetConversionStatus` | 查询当前状态，可轮询 |
| `prompt.getPresetConversionResult` | `{ taskId: string }` | `PresetConversionResult` | 仅在 `ready` 状态返回结果，可重复读取 |
| `prompt.cancelPresetConversion` | `{ taskId: string }` | `{ success: true }` | 中止活动任务；终态任务重复取消不改变状态 |
| `prompt.onPresetConversionProgress` | `(status) => void` | `() => void` | 桥接订阅函数；调用返回函数取消订阅 |

进度事件通道为 `preset-conversion:progress`，载荷就是完整的 `PresetConversionStatus`，没有额外包裹。事件包含所有转换任务，调用方按 `taskId` 过滤。应在开始前订阅；收到任务 ID 后立即查询状态，以补偿订阅时序或丢失的事件。`queued` 不保证单独推送。

这些方法属于应用级预设库。`sessionId` 仅用于选择项目的生成连接，不把预设保存到项目数据库，也不读取章节正文作为转换资料。

## 开始与检查的入参

```ts
type PresetConversionInput = {
  jsonContent: string
  fileName?: string
  sessionId?: string
  connectionId?: string
}
```

| 字段 | 约束 | 说明 |
| --- | --- | --- |
| `jsonContent` | 非空字符串；最多 32 MiB 的 UTF-8 内容，同时限制最多 32 × 1024 × 1024 个 UTF-16 代码单元 | 完整 JSON 文本，允许开头有 BOM；不接收文件路径或 URL |
| `fileName` | 去除首尾空白后 1～255 个字符 | 显示名称和报告字段；不会作为存储路径 |
| `sessionId` | 可选 UUID | 显式连接未指定时，读取该会话项目的 `continue` 任务路由 |
| `connectionId` | 可选 UUID | 显式选择现有 `generation` 连接，优先于项目路由 |

两次调用应传入相同内容；检查不会创建可复用的来源对象，开始时会重新解析和检查预算。检查返回的哈希可用于确认两次选择的是同一份文本。

支持的来源格式：本项目单个预设对象（含 `blocks`）、酒馆对象（含 `prompts` 或 `system_prompt`）、酒馆提示词数组。不接受整个本项目预设库对象作为单个预设导入。最多允许 4096 个解析后的来源条目。

本项目格式直接通过现有 `NovelPromptPresetSchema` 校验，生成新的预设 ID 和时间戳，保留块和已有报告，不调用 AI，也不进入酒馆转换编译校验。其结构是否合法与是否适合当前创作任务是两个不同判断。

### 连接选择与发送内容

连接按以下顺序选择：显式 `connectionId` → `sessionId` 的 `continue` 路由 → 唯一的生成连接。存在多个生成连接且没有可用路由时，检查返回 `connection: null`，开始返回 `CONNECTION_NOT_FOUND`。指定错误连接或会话时不会忽略该错误并自动改选。

开始需要现有连接已完成目标端点确认，复用连接的密钥、模型、上下文预算和网关，不创建独立的转换配置。每次请求前后检查连接版本；转换期间修改连接会使任务失败，需要重新开始。

酒馆来源的完整提示词、脚本、正则和扩展配置都会作为资料分批发送到所选模型，包含文件自身携带的敏感文本。不会下载文件内引用的远程资源，不执行 JavaScript、Slash 命令或正则。转换请求使用现有模型队列的 `low` 优先级。

## 检查返回值

```ts
type PresetConversionInspection = {
  format: 'novel' | 'tavern'
  name: string
  sourceFingerprint: string
  sourceCharacters: number
  items: PresetSourceItem[]
  referenceVersion: string
  references: Array<{ name: string; revision: string; url: string }>
  connection: { id: string; version: number; name: string; model: string } | null
  estimatedSourceTokens: number | null
  initialAnalysisBatches: number | null
  warnings: string[]
}

type PresetSourceItem = {
  sourceId: string
  path: string
  name: string
  kind: 'prompt' | 'order' | 'script' | 'regex' | 'extension' | 'settings'
  characters: number
  enabled: boolean | null
  order: number | null
}
```

`sourceFingerprint` 是原始输入字符串按 UTF-8 编码后的 SHA-256，包括 BOM、空白和换行差异。所有 `characters` 均为 JavaScript 字符串长度（UTF-16 代码单元），不是字节数。

`items` 提供来源索引，不返回脚本原文。`sourceId` 只在这次解析中标识条目，不是跨文件身份。`path` 例如 `$.prompts[0]` 或 `$.extensions.tavern_helper.scripts[0]`。`enabled: null` 表示未识别明确开关，不表示停用；`order: null` 表示非提示词顺序条目。

提示词顺序优先使用 `character_id: 100001` 的组，其次使用第一个包含 `order` 的组或扁平顺序数组。选择的非空顺序中未列出的提示词默认停用；已列出的提示词采用顺序项开关，缺少开关时采用提示词自身开关，否则默认启用。其他顺序组仍进入来源清单供模型分析。

`estimatedSourceTokens` 按连接的估算系数计算来源序列化文本，不包含参考指令、schema、摘要整合、输出或重试，不是总费用估算。`initialAnalysisBatches` 只计初始分析批次，不是总请求次数。本项目格式或未选出模型时，这两个值及 `connection` 都为 `null`；本项目格式的 `items` 为空。

参考资料固定于代码版本 `2026-10-12.1`，指向带提交哈希的 SillyTavern 和 JS-Slash-Runner 源码。转换不实时联网拉取规范。参考摘要只覆盖部分变量宏、格式化宏和宏注册机制，未知行为仍需报告为不确定或不支持。

## 任务状态、进度与取消

```ts
type PresetConversionStatus = {
  taskId: string
  name: string
  state: 'queued' | 'analyzing' | 'summarizing' | 'converting'
       | 'validating' | 'ready' | 'failed' | 'cancelled'
  completedBatches: number
  totalBatches: number
  usage: PresetConversionUsage
  createdAt: number
  updatedAt: number
  error: { code: string; message: string } | null
}

type PresetConversionUsage = {
  promptTokens: number
  completionTokens: number
  totalTokens: number
  requests: number
  reportedRequests: number
}
```

所有时间戳均为 Unix 毫秒。酒馆正常路径为 `queued → analyzing → summarizing → converting → validating → ready`；本项目格式为 `queued → ready`。活动阶段可进入 `failed` 或 `cancelled`。异步错误存于状态的 `error`，开始前的错误直接由开始接口返回。

`completedBatches` 是已返回并通过该请求结构校验的逻辑请求数，后续来源 ID 或编译校验仍可能失败。`totalBatches` 随摘要层级和转换批次追加，不能当作固定总量或可靠百分比；任务失败时不要求两者相等。至少需要 2048 输出 token，且扣除连接安全余量、输出预留和指令/schema 预算后的来源预算至少为 2048 token；单批来源预算上限为 60000 token。超过预算不会强行发送请求。

大来源条目连续分片分析，然后整合每个来源及全局关系。摘要上限为 2500 字符，递归整合最多 16 层。每批来源 ID 必须完整且唯一；无法收敛或单条目超预算会失败，不静默跳过条目。全部原文发送分析不代表模型理解没有遗漏。

`usage.requests` 统计已提交给网关的逻辑结构化请求，不是 HTTP 请求数，网关重试/修复不会单独计数。token 数累计网关返回的 usage；`reportedRequests` 统计返回 usage 的逻辑请求。没有提供 usage 时计数可为零，因此不能据此计算精确账单。

每个后端服务实例同时只允许一个非终态转换。取消立即将状态标为 `cancelled` 并触发 AbortSignal；远端已经接受的请求不保证撤销费用。取消不删除来源归档，不保存部分结果。对 `ready`、`failed` 或 `cancelled` 再取消会返回成功并保留原状态。

任务及结果只保存在内存中，最多保留最近 8 个任务；新建任务时淘汰旧终态。应用重启、服务关闭或任务被淘汰后无法恢复或继续。不存在的任务返回 `VALIDATION_ERROR`。

## 转换结果与兼容报告

```ts
type PresetConversionResult = {
  taskId: string
  format: 'novel' | 'tavern'
  preset: NovelPromptPreset
  warnings: string[]
}

type NovelPromptPreset = {
  id: string
  name: string
  description?: string
  blocks: Array<{
    id: string
    name: string
    role: 'system' | 'user' | 'assistant'
    content: string
    enabled: boolean
    position: 'relative' | 'in_chat'
    depth: number
    order: number
    marker?: string
  }>
  conversionReport?: PresetConversionReport
  createdAt: number
  updatedAt: number
}

type PresetConversionReport = {
  sourceFingerprint: string
  fileName?: string
  referenceVersion: string
  references: Array<{ name: string; revision: string; url: string }>
  model: {
    connectionId: string
    connectionVersion: number
    name: string
    model: string
  }
  createdAt: number
  convertedFingerprint: string
  modified: boolean
  compatibility: 'ai-adapted-static'
  items: Array<{
    sourceId: string
    path: string
    name: string
    kind: PresetSourceItem['kind']
    disposition: 'retained' | 'adapted' | 'ignored' | 'unsupported'
    reason: string
    targetBlockIds: string[]
    losses: string[]
  }>
  warnings: string[]
  usage: PresetConversionUsage
}
```

报告在 `result.preset.conversionReport` 中，没有独立的 `result.report` 字段。酒馆 AI 结果必有报告，本项目格式可以没有报告或携带原报告。`model` 只记录连接身份和版本，不包含端点密钥。

每个来源条目都有处理结论：`retained` 表示保留为静态块，`adapted` 表示改写，`ignored` 表示有理由地略过，`unsupported` 表示当前静态能力无法承载。前两者必须产生块，后两者必须没有目标块。脚本或正则产生静态块时必须是 `adapted` 且具有损失说明。目标块 ID 由后端生成，供报告定位；自动补足的必要资料插槽没有来源条目。

目标只包含静态文本、角色、相对位置、历史深度和已有资料插槽，不包含可执行兼容规则。插槽为 `marker.project_rules`、`marker.outlines`、`marker.knowledge`、`marker.synopsis`、`marker.style_samples`、`marker.references`、`marker.suggestions`、`marker.preset`、`marker.target`、`marker.history`、`marker.task`。

已识别停用的来源不会生成启用块；模型也可以停用无法直接使用的块。启用块不得含双花括号宏或空的非插槽内容。结果需至少一个启用的创作文本块，且恰好一个启用的历史插槽和作者任务插槽。

后端使用现有提示词编译器检查续写、改写、润色、对话、方向、章纲和正文任务：保留内置任务协议、资料和作者任务恰好注入一次、资料位于作者任务之前且没有空消息。这里的检查发生于转换服务内部，并不证明生成文本会遵守全部写作意图。模型适配及其损失判断仍需人工审阅。

`convertedFingerprint` 对名称、描述及块的可编辑内容计算哈希，排除预设/块 ID、时间戳和报告。预设库加载与保存时重新计算 `modified`：编辑后与初始结果不同为 `true`，恢复初始内容后为 `false`。报告不因编辑重新生成；`modified` 为真时不能把旧报告当作当前文本的转换评估。

## 来源保存与预设确认

开始时，后端先把原始输入字符串编码为 UTF-8，写入应用数据目录的 `preset-conversion-sources/<sourceFingerprint>.json`。相同哈希不重复写入；无法保存时不开始转换。该目录保存本项目格式及酒馆格式，也保留失败和取消任务的输入，不自动清理。来源哈希在结果报告或检查结果中可查到。

来源归档不等于导入预设库。完成转换后仍须审阅 `preset.blocks`、报告处理结论和损失，再明确调用已有保存接口。接口不会自动启用结果，也不修改已有预设或数据库。

已有保存接口为：

```ts
prompt.getPresetStore(): Promise<{
  store: { activePresetId: string | null; presets: NovelPromptPreset[] }
  warnings: string[]
}>

prompt.savePresetStore(input: {
  activePresetId: string | null
  presets: NovelPromptPreset[]
}): Promise<{
  store: { activePresetId: string | null; presets: NovelPromptPreset[] }
  warnings: string[]
}>
```

`savePresetStore` 替换整个应用预设库，不是追加接口，也没有版本冲突检测。确认前应重新读取最新预设库，把结果追加后保存，保留当前 `activePresetId`；确认启用时才将其设置为新预设 ID。多调用方并发保存需由调用方串行协调。

桥接调用示例（独立于导入界面）：

```ts
const prompt = window.novelAgent.prompt
const input = { jsonContent, fileName, connectionId }
const inspection = await prompt.inspectPresetConversion(input)
// 调用方确认所选模型和发送内容后开始。
let taskId: string | undefined
const unsubscribe = prompt.onPresetConversionProgress(status => {
  if (status.taskId === taskId) consumeStatus(status)
})
try {
  taskId = (await prompt.startPresetConversion(input)).taskId
  const status = await prompt.getPresetConversionStatus({ taskId })
  consumeStatus(status)
  // 继续通过事件或轮询等待 ready；失败读取 status.error。
} catch (error) {
  unsubscribe()
  throw error
}
// 终态或调用方退出时调用 unsubscribe()。
```

以下保存步骤单独在 `ready` 且调用方已确认转换结果后执行：

```ts
const result = await prompt.getPresetConversionResult({ taskId: taskId! })
const latest = await prompt.getPresetStore()
await prompt.savePresetStore({
  activePresetId: latest.store.activePresetId,
  presets: [...latest.store.presets, result.preset]
})
```

示例将等待及确认留给调用方，不应把 `start` 返回当成 `ready`。本轮没有增加前端确认流程。已有前端仍调用 `prompt.parseTavernFile` 的静态导入路径；新流程不会被该旧入口自动触发，前端接入时须改用上述接口。

## Sidecar 与错误

Sidecar 使用逐行 JSON-RPC 2.0。`method` 就是表中的 IPC 通道，`params` 是完整入参对象，成功 `result` 是相应返回值，例如：

```json
{"jsonrpc":"2.0","id":1,"method":"prompt.getPresetConversionStatus","params":{"taskId":"11111111-1111-4111-8111-111111111111"}}
```

事件通知格式为 `{ "jsonrpc": "2.0", "method": "event", "params": { "channel": "preset-conversion:progress", "payload": status } }`。业务失败沿用 Sidecar 的 `-32000` 错误外壳，业务码在 `error.data.domainCode` 中；直接调用 ServiceRouter 时沿用 `{ ok: true, value }` / `{ ok: false, error: { code, message } }` 外壳。桌面桥会解包返回值并抛出业务错误。

| 业务码 | 常见原因与处理 |
| --- | --- |
| `VALIDATION_ERROR` | 入参违反契约、任务不存在/过期、选了非生成连接；修正输入或重新开始 |
| `IMPORT_INVALID` | 无效 JSON、格式不识别、本项目预设结构无效、文件或来源条目数超限 |
| `CONNECTION_NOT_FOUND` | 缺少网关/生成连接、多个连接未指定、连接已删除 |
| `CONTENT_TARGET_CONFIRMATION_REQUIRED` | 现有连接的联网目标尚未确认；使用既有连接确认流程 |
| `INVALID_STATE_TRANSITION` | 已有活动转换、服务关闭或结果尚未 `ready`；查询状态或取消后再开始 |
| `MODEL_CONTEXT_EXCEEDED` | 输入/输出预算不足、批次超限或摘要不收敛；调整连接预算或拆分来源 |
| `MODEL_OUTPUT_INVALID` | 输出结构、来源覆盖、处置结论、宏或编译校验失败；审查来源与模型后重试 |
| `VERSION_CONFLICT` | 转换期间连接版本变化；重新开始 |
| `TASK_CANCELLED` | 转换已取消；无需保存部分结果 |
| `DATABASE_ERROR` | 原始文件归档或预设库写入失败；检查数据目录权限 |

模型网关、项目会话读取还可能返回其原有错误码。本表不是全应用错误码白名单。异步阶段失败不提供部分可保存的预设。

## 后续集中测试范围

按项目约定，本次未新增或运行测试。独立的集中测试阶段需要覆盖以下公开行为，并更新现有桥接 API 清单断言：

- 无效输入、两种来源格式、原文件归档与哈希、native 路径零模型调用、零隐式保存。
- 连接优先级、目标确认、预算上下限、转换中连接修改/删除。
- 完整来源分片、跨条目摘要、来源 ID 遗漏/重复、超长摘要、脚本/正则缺少损失报告。
- 状态事件和轮询一致性、取消、终态重复取消、单活动任务、结果淘汰和关闭清理。
- 停用来源保持停用，启用宏/空块/重复插槽拒绝，创作任务编译和材料顺序。
- 报告持久化、编辑后修改标记、恢复初始内容、全库保存不误激活预设。
- 使用下载目录四份现有 fixture 对比转换报告与写作意图；普通测试使用可控模型桩，真实模型评估单独安排，不写针对文件名的转换分支。

现有四份 fixture 的静态导入测试不能证明新增 AI 转换路径已经通过，也不能证明酒馆插件行为被等价复现。
