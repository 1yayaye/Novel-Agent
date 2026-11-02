# 模式 B 重构与真实模型端到端测试报告（Izumi 1002 + 《妈妈的末日修仙》）

## 1. 模式 B 重构前后对比

针对原有模式 B 将整份预设无差别切碎为 200+ 次请求的问题，已完成 [`src/main/preset-conversion.ts`](../../src/main/preset-conversion.ts) 的两阶段架构重构：

| 维度 | 旧版模式 B（重构前） | 新版模式 B（两批次重构后） |
| :--- | :--- | :--- |
| **本地零 Token 预清洗** | 无（669 KB Webpack 悬浮窗代码、176 个停用块全部发给 AI） | 本地按 `character_id: 100001` 解析顺序、展开静态 `setvar`/`getvar`、直接归档停用块与空白分隔条、提取脚本/正则特征摘要 |
| **AI 请求总批次 (`Izumi 1002.json`)** | **200+ 批**（逐片分析 + 16 层递归摘要 + 4 条/批转换） | **2 批**（第 1 批全局诊断 + 第 2 批写时复制静态适配） |
| **转换总耗时** | > 30 分钟（且极易因跨批插槽重复校验失败） | **88.91 秒**（第 1 批 54.77s + 第 2 批 33.91s） |
| **转换 Token 消耗** | 预计 > 1,300,000 Tokens | **输入 14,832 / 输出 6,313 Tokens** |
| **插槽与残留宏校验** | 跨批次容易产生多个 `marker.history`/`marker.task` 导致末尾报错 | 第 1 批全局锁定唯一插槽 + 写时复制（`rewrittenContent: null`）+ 末尾归一化去重 |

---

## 2. 真实测试执行概览与性能指标

- **测试脚本**：[`tests/real-execution.test.ts`](../../tests/real-execution.test.ts)
- **模型服务**：`https://<endpoint>/v1`（`gemini-3.8-flash`，端点已脱敏）
- **测试预设**：[`Izumi 1002.json`](../../tests/fixtures/tavern-presets/Izumi%201002.json)（264 个源条目，总长 1,144,619 字符）
- **测试小说**：`<本地路径>/《妈妈的末日修仙》1-37.txt`（承接第 37 章末尾草地哭泣场景续写）

### 实测度量数据（摘自 [`06_run_metrics.json`](../../test-results/real-execution/2026-10-12T21-16-20-992Z_modeB/traces/06_run_metrics.json)）
- **阶段一：模式 B 预设转换**
  - **LLM 请求次数**：**2 次**
  - **总耗时**：**88.91 秒**
  - **Token 统计**：Prompt `14,832` / Completion `6,313` / Total `25,943`
  - **转换产出**：生成 75 个预设块（其中 **启用 13 块**，保留停用 62 块供按需开启），完整记录全部 264 个来源条目的兼容处置结论。
- **阶段二：第 37 章末尾正文续写 (`continue`)**
  - **组装消息数**：**19 条**
  - **首字延迟 (TTFT)**：**2.63 秒**
  - **续写总耗时**：**42.61 秒**
  - **Token 统计**：Prompt `18,336` / Completion `3,681` / Total `22,017`
  - **生成正文字数**：**4,703 字**（100% 纯净小说正文，无任何思维链/吐槽/状态栏标签污染）

---

## 3. 模式 B 转换质量与续写效果分析

1. **精准剥离酒馆 RP 外壳与非正文标签**：
   - 在模式 A（纯静态正则导入）中，`Izumi 1002` 的“泉此方/Master”元叙事对话、日语外显思维链 `<konatan_planning~>`、`<tucao>` 气泡、`<current_event>`/`<progress>` 状态栏、`<advice>` 建议块会原样保留并污染小说正文输出。
   - 在重构后的 **模式 B** 中，AI 在第 1 批全局诊断中识别出这些机制，并在第 2 批转换中：
     - 将 `<tucao>`、`<current_event>/<progress>`、`<advice>`、伪造 Assistant 接单回复及冗余闭合标签标记为 `ignored`；
     - 将 `<konatan_planning~>` 中的**场景要素核查、有限视角检查、反套路审视、详略规划**转化为 `【创作前内部静默构思规范】`（要求模型在内部静默构思，直接输出小说正文，严禁输出思考标签）；
     - 完整保留并提炼了 Izumi 预设精华的 `【叙事要求与行文规范】`、`【反套路剧情指导】`、`【镜头与描写规范】`（如心理描写使用斜体、无聊过渡果断切镜头）、`【文风规范：去生硬与生活质感】` 与 `【写作禁用词与病句清单】`。
2. **启用扩展与正则的客观兼容报告**：
   - `泉此方悬浮窗`（669 KB Webpack 脚本）与依赖楼层深度动态裁剪历史的正则（`9只保留Progress(11楼后)`、`10隐藏近期旧Progress(4-10楼)`、`13杀极其共犯由于并不存在的`）被准确标记为 `unsupported` 并附带具体的静态化能力损失说明；其余 16 个纯前端 CSS/HTML 折叠美化正则被准确标记为 `ignored`。

---

## 4. 全量后台审计文件清单

所有后台发送给模型的完整提示词、Schema 及模型完整原始回复均已落盘至：
`test-results/real-execution/2026-10-12T21-16-20-992Z_modeB/traces`

1. **模式 B 预设转换 — AI 完整请求与回复记录（核心审计文件）**
   - Markdown 易读版：[`00_mode_b_conversion_llm_trace_readable.md`](../../test-results/real-execution/2026-10-12T21-16-20-992Z_modeB/traces/00_mode_b_conversion_llm_trace_readable.md)
   - 原始 JSON 版：[`00_mode_b_conversion_llm_trace.json`](../../test-results/real-execution/2026-10-12T21-16-20-992Z_modeB/traces/00_mode_b_conversion_llm_trace.json)
2. **模式 B 转换产出预设与 264 项兼容报告**
   - [`01_preset_conversion_report.json`](../../test-results/real-execution/2026-10-12T21-16-20-992Z_modeB/traces/01_preset_conversion_report.json)
3. **正文续写上下文组装明细 (`ContextAssembler`)**
   - [`02_assembled_context_breakdown.json`](../../test-results/real-execution/2026-10-12T21-16-20-992Z_modeB/traces/02_assembled_context_breakdown.json)
4. **正文续写发送给模型的完整 Prompt Messages（19 条消息）**
   - Markdown 易读版：[`03_sent_prompt_messages_readable.md`](../../test-results/real-execution/2026-10-12T21-16-20-992Z_modeB/traces/03_sent_prompt_messages_readable.md)
   - 原始 JSON 版：[`03_sent_prompt_messages.json`](../../test-results/real-execution/2026-10-12T21-16-20-992Z_modeB/traces/03_sent_prompt_messages.json)
5. **模型完整无截断续写回复（4,703 字正文）**
   - [`05_model_full_response.md`](../../test-results/real-execution/2026-10-12T21-16-20-992Z_modeB/traces/05_model_full_response.md)
6. **运行耗时与 Token 统计 / 酒馆对比指南**
   - [`06_run_metrics.json`](../../test-results/real-execution/2026-10-12T21-16-20-992Z_modeB/traces/06_run_metrics.json)
   - [`07_sillytavern_comparison_guide.md`](../../test-results/real-execution/2026-10-12T21-16-20-992Z_modeB/traces/07_sillytavern_comparison_guide.md)
