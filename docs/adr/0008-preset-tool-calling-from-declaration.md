# ADR-0008：预设工具调用 schema 由导入器从预设声明解析

状态：已采纳。

部分酒馆预设（如 Meowssiah 1.9.12）通过强制工具调用返回全部输出。此前 `resolvePresetTools` 对 `soliumbra_reply` 一律使用硬编码的 `SOLIUMBRA_REPLY_TOOL`，导入器只做关键词启发式（命中即给 `{enabled, name}`），预设里真正的工具契约——`extensions/SPreset/ToolBindings` 的表单定义和 prompt 正文中 `<<<|catgodml|registerPart:部件:描述>>>` 宏（酒馆在请求期动态拼装 schema）——都被丢弃。换一个部件名或工具名不同的预设即失效，且解析器正文别名不含 `story_body`、`extra` 字段被静默丢弃。

## 决策

- 导入器拥有"预设如何声明工具"的知识：`tavern-importer.ts` 在清洗剥离宏之前收集启用 prompt 中的 registerPart 部件，并读取第一个 `enabled && valid` 的 ToolBindings 表单（name/description/基础参数），组装成 JSON Schema 存入 `preset.toolCalling.parameters`。不解析 ToolBindings 的 `code` JS 串。
- `resolvePresetTools` 优先消费 `preset.toolCalling.parameters`；无 parameters 时维持原兜底：`soliumbra_reply` 用 `SOLIUMBRA_REPLY_TOOL`，其余用 `GENERIC_NOVEL_REPLY_TOOL`。存量已导入预设无 parameters，走兜底，无需迁移。
- registerPart 部件覆盖 ToolBindings 同名基础参数，但一律不进 `required`，仅保留声明式 required（本例 `['think_nya']`）——刻意比酒馆源脚本的 OPTIONAL_PARTS 全量必填宽松，与既有评审结论一致：强制工具选择已保证调用发生，宽松 schema 减少截断与失败面。
- 解析器 `output-parser.ts` 正文别名补 `story_body`；`extra` 不作正文，并入 comment 展示。
- 不复制酒馆的伪造 few-shot 历史、诱饵 context 工具、thoughtSignature 占位与 `propertyOrdering`：预设正文在本应用中直接作为消息发送，工具调用惯性由强制 tool_choice 提供，解析按字段名进行与顺序无关。

## 补记：解析器实际落地行为（2026-11-03 评审后补记）

实现时 `output-parser.ts` 的落地范围超出上文"正文别名补 story_body；extra 并入 comment"两条，实际决策如下：

- **正文别名表**：`game_content/content/story/story_body/text/prose/chapter_content`（正文）、`think_nya/thinking/thought/analysis`（推演）、`comment/cat_comment/author_comment/note/notes/extra`（留言）、`options/choices/plot_options/plotOptions/fox_selc`（选项）——覆盖 Meowssiah 系及其衍生预设的真实字段拼写。
- **工具参数解析独立成模块**：`src/main/tool-call-args.ts` 拥有 `parseToolCallArguments`。参数先按标准 JSON 解析；失败后尝试补全（奇数引号补 `"`、缺尾补 `}`）再做贪婪正则逐字段抽取。它只服务于"完整但语法拖泥带水"的输出；**max_tokens 截断不在此修复范围**。
- **截断防护**：强制 tool_choice 只保证调用发生，不保证调用完整。`model-gateway.ts` 在流式与非流式两条路径上，对 `finish_reason=length` 且携带 responseFormat 或 tools 的请求直接抛 `MODEL_OUTPUT_INVALID`（`isTruncatedOutput`），不把半截参数交给下游静默修复。
- **裸 JSON 嗅探与选项前缀清洗**：无工具调用时，解析器对以 `{` 开头的原始输出尝试合成伪工具调用并走同一参数解析路径；XML/Markdown 选项行做序号前缀清洗（`OPTION_PREFIX_REGEX`）。
- **工具名唯一事实来源**：`SOLIUMBRA_TOOL_NAME` 常量定义于 `src/shared/prompt-settings.ts`（schema 默认值同源），工具定义、导入识别、输出解析、测试一律引用该常量。

## 影响

导入 Meowssiah 类预设后，请求 payload 的 `tools` 与预设声明一致，新增部件（如 `extra`）不再丢失。AI 转换流（`preset-conversion.ts`）暂不收集工具声明，其产物仍走兜底工具。工具 schema 随预设指纹入库，重新导入即得新 schema。
