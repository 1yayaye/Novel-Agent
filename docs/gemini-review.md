# 代码审查报告 (Gemini Code Review)

- **审查对象**：工作区未提交改动（相对于 `HEAD` / commit `c9ab066c32359b9ad0c6274fc8cbe2112946e3a2` 的工作树全量 Diff 与新增未跟踪文件）
- **规范基准 (Standards)**：`AGENTS.md`（John Ousterhout 《软件设计哲学》法则）、项目通用原则（避免过度设计、最简生效代码、消除无用抽象）、Fowler 代码坏味道基线
- **规格依据 (Spec)**：`docs/preset-conversion-api.md`（预设转换后端接口规格）

---

## Standards

### Hard Violations (Documented Standards)

1. **`src/main/prompt-store.ts` & `src/main/service-router.ts`**
   - **规则**：`AGENTS.md`（*“Design interfaces around what callers need to know... avoid fragile staging, setup sequences... hidden dependencies, temporal coupling”*）。
   - **问题**：`promptSettingsStore()` 依赖全局可变单例状态 `activeStore`，要求在外部显式调用 `initPromptSettingsStore()` 注入数据目录。`createServiceRouter` 绕过了 `deps: ServiceRouterDependencies` 的标准依赖注入机制直接访问全局单例，引入隐式时序耦合与状态穿透。

2. **`src/main/preset-conversion.ts` & `src/shared/preset-conversion.ts`**
   - **规则**：`AGENTS.md`（*“Choose generality at the right level. Avoid vague speculative abstractions”*）与全局规范（*“Don't over-engineer; Don't keep old code 'just in case'”*）。
   - **问题**：在后端构建并暴露了 550+ 行的多轮 AI 转换通道与任务调度管线，但当前渲染层前端完全未接入该流程（前端仅调用静态导入 `prompt.parseTavernFile`），形成了无消费者的庞大投机后端抽象。

3. **`src/renderer/components/dialogs/CreativeSettingsDialog.tsx` (`estimateTokenCount`)**
   - **规则**：`AGENTS.md`（*“Hide volatile decisions... bookkeeping, normalization inside the module that owns the knowledge”*）。
   - **问题**：在 UI 视图组件层硬编码 `Math.ceil(text.length * 1.3)` 估算 Token，将底层模型连接与网关的 Token 估算内部算法和配置泄露到了前端展示层。

---

### Judgement Calls (Baseline Smells)

1. **Duplicated Code** — `src/main/prompt-runtime.ts` (L164–169 & L190–195)：
   - 同一函数中构建作者任务消息与参数格式化的逻辑重复出现两次：
   ```ts
   const parameters = [
     input.targetLength ? `目标篇幅约 ${input.targetLength} 字...` : '',
     input.creativity ? `探索范围：${...}` : '',
     input.instruction.trim() || '请根据以上资料完成本次任务。'
   ].filter(Boolean)
   messages.push({ role: 'user', content: `【本次作者任务】\n${parameters.join('\n')}` })
   ```

2. **Primitive Obsession** — `src/main/analysis-runner.ts` (L263, L473–476)：
   - 结构化输入对象被序列化为 JSON 字符串传递，随后在内部立即被解析回对象：
   ```ts
   const instruction = this.presetInstruction(input.sessionId, JSON.stringify({ presetId: input.presetId, instruction: input.instruction }))
   ```

3. **Divergent Change & Mysterious Name** — `src/renderer/components/dialogs/CreativeSettingsDialog.tsx`：
   - 1465 行单体组件混杂了全局提示词预设、全书准则、章节指令预设和文风样本 4 类领域状态；Tab `settings` 编辑全局 `NovelPromptPreset`，而 Tab `presets` 编辑项目级 `InstructionPreset`，概念命名发生冲突，认知负载极高。

4. **Middle Man** — `src-winui/IpcBridge.cs` (L137, L417–434)：
   - `backup.openLocation` 在对话框通道路由中被专门拦截，但其逻辑仅为原样深拷贝 payload 并转发给 `_sidecar`，与 default fallback 分支的行为完全一致，属于多余的透传中间人。

---

## Spec

*依据规格来源：`docs/preset-conversion-api.md`*

### (a) Requirements Missing or Partial

1. **丢失 Tavern 预设的 `description` 解析与写入**：
   - **Spec L144/L201**：`description?: string` 以及 *“`convertedFingerprint` 对名称、描述及块的可编辑内容计算哈希，排除预设/块 ID、时间戳和报告。”*
   - **问题**：`src/main/preset-conversion.ts`（L151–L155）的 `readSource` 仅解析了 `root.name`，忽略了 `root.description`；在组装预设对象时（L490），`description` 始终为 `undefined`。

2. **`targetBlockIds` 字段约束过度严格**：
   - **Spec L183/L46**：`targetBlockIds: string[]` 以及 *“本项目格式直接通过现有 `NovelPromptPresetSchema` 校验...保留块和已有报告”*。
   - **问题**：`src/shared/prompt-settings.ts`（L46）中 `targetBlockIds` 被约束为 `z.array(z.string().uuid())`。由于原生预设的块 ID 允许为普通字符串标识符，这会导致合法的原生预设已有报告校验失败。

### (b) Behaviour Not Asked For (Scope Creep)

1. **提前引入庞大未确认的前端 UI 变更**：
   - **Spec L3/L262**：*“本次没有实现导入界面”*，*“本轮没有增加前端确认流程。已有前端仍调用 `prompt.parseTavernFile` 的静态导入路径”*。
   - **问题**：未提交改动中包含了 `CreativeSettingsDialog.tsx` 的大量交互重构与提示词工作台代码（+1,698 行），超出了当前阶段后端转换接口的交付边界。

2. **提前引入后续阶段测试套件**：
   - **Spec L290**：*“按项目约定，本次未新增或运行测试。独立的集中测试阶段需要覆盖以下公开行为...”*。
   - **问题**：工作区中直接新增了多个未到执行阶段的测试文件（如 `tests/tavern-preset.test.ts`、`tests/presets-eval.test.ts`、`tests/prompt-sidecar-bridge.test.ts` 等）。

### (c) Implemented but Implementation Looks Wrong

1. **`character_id` 全等判断逻辑漏洞**：
   - **Spec L88**：*“提示词顺序优先使用 `character_id: 100001` 的组，其次使用第一个包含 `order` 的组...”*。
   - **问题**：`src/main/preset-conversion.ts`（L106）使用 `entry.character_id === 100001` 进行判断。酒馆预设中经常出现字符串形式 `"100001"`，严格全等会导致优先组匹配失败并错误回退到首个顺序组。

2. **非预期的强制注入 `knowledge` 插槽**：
   - **Spec L197**：*“结果需至少一个启用的创作文本块，且恰好一个启用的历史插槽和作者任务插槽。”*
   - **问题**：`src/main/preset-conversion.ts`（L483）自动补全的必要插槽列表中包含了 `knowledge`（`['knowledge', 'history', 'task']`），超出了规范明确要求的必要集合（仅 `history` 与 `task`）。

3. **非排序条目排位倒置（`order: null` 被置于 0 之前）**：
   - **Spec L86**：*“`order: null` 表示非提示词顺序条目。”*
   - **问题**：`src/main/preset-conversion.ts`（L471）采用 `(a.order ?? -1) - (b.order ?? -1)` 排序。当 `order` 为 `null` 时取 `-1`，导致脚本、正则和扩展等非提示词条目在生成的预设块中被排到了提示词 0 之前。

---

## 结论汇总

- **Standards 轴**：共发现 7 处问题（3 处规范硬违规，4 处代码坏味道），最严重问题为 `CreativeSettingsDialog.tsx` 超大单体组件造成的领域命名混淆与前端估算逻辑泄露；
- **Spec 轴**：共发现 7 处问题（2 处缺失/不完全，2 处范围蔓延，3 处实现偏差），最严重问题为 `preset-conversion.ts` 中 `order: null` 条目以 `-1` 排序导致非提示词内容倒置排在 Prompt 0 之前。
