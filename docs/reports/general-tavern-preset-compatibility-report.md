# 酒馆预设通用兼容与交错输出处理完成报告

## 1. 改造背景与目标

针对导入和使用 SillyTavern 提示词预设（以 `Kemini_Dramatron_v3.1.json` 为例）时暴露出的通用规范差异，遵循 **《A Philosophy of Software Design》**（深模块原则，对外接口稳定且简单，对内完整承载复杂度）与**通用化改造原则（严禁针对单一预设 hardcode 正则或特定特判）**，完成了以下四个核心维度的通用增强与全面回归测试。

---

## 2. 核心改动清单

### (1) 标准变量宏解析与静态展开 (`src/main/tavern-importer.ts`)
- **对齐规范**：参照酒馆官方 `variables.js` 行为规范，建立标准变量表求值引擎 `resolveTavernVariables`。
- **求值规则**：
  - 按 Block 顺序解析已启用的 `{{setvar::变量名::变量值}}` 与 `{{setglobalvar::变量名::变量值}}`，提取值并将其从提示词中剥离。
  - 支持多层递归展开 `{{getvar::变量名}}`（最大深度 5 次，防止循环引用），替换为具体值。
- **纯宏 Block 处理**：仅含 `setvar` 声明或求值后内容为空的非标记插槽 Block，保留在预设中但自动置为 `enabled: false`，避免污染后续提示词装配。

### (2) 通用注释与控制宏清洗 (`src/main/tavern-importer.ts`)
- **注释过滤**：支持酒馆通用内部注释语法 `{{// 注释内容 }}`，在文本装配前自动剔除，杜绝作者注解泄漏到 LLM 上下文中。
- **空白控制宏**：支持 `{{trim}}` 过滤，消除前后无意义换行。

### (3) 官方任务插槽语义映射与空 Block 保护 (`src/main/tavern-importer.ts` & `src/main/prompt-runtime.ts`)
- **任务标记识别**：在 `detectBlockMarker` 中扩充对 SillyTavern 官方插槽 `agentTask` / `agent_task` 的识别，自动映射为系统内部插槽 `marker.task`，避免末尾追加重复空插槽。
- **运行时保护**：在 `compilePromptMessages` 装配提示词阶段，对 `trim()` 后内容为空的 Block 自动跳过，防止空 Block 产生无意义的空消息角色。

### (4) 交错思考与多段推理净化 (`src/main/output-parser.ts`)
- **标签扩展**：将 `thought`、`interleaving`、`interleaved_thinking` 统一纳入已识别标签表 `KNOWN_TAGS`。
- **正文无缝拼接**：针对大模型（如 Gemini / Claude / DeepSeek）交错输出思考的场景：
  ```xml
  <Interleaving>
  <thinking>第一段推演</thinking>
  第一段小说正文
  <thinking>第二段推演</thinking>
  第二段小说正文
  </Interleaving>
  ```
  `stripReasoning` 在剥离全部 `<thinking>` 段落的同时平滑解包 `<Interleaving>` 包装，提取出连续纯净的小说正文，彻底消除任何残留标签。

---

## 3. 测试与验证结果

### 自动化单元与隔离测试
- `tests/tavern-preset.test.ts` (12 tests) - 全部通过：
  - 验证标准宏变量提取与多层展开。
  - 验证 `{{// ...}}` 注释剥离与 `{{trim}}` 清洗。
  - 验证纯变量声明 Block 自动置为 `enabled: false`。
  - 真实预设 `Kemini_Dramatron_v3.1.json` 端到端解析，确认所有变量已替换、任务插槽正确对齐、无残留宏语法。
- `tests/output-parser-isolation.test.ts` (11 tests) - 全部通过：
  - 新增 `Category 5` 交错思考测试，验证 `<Interleaving>` 与多段 `<thinking>` 完美剥离并正确拼接正文。

### 全库回归测试
执行 `pnpm test`：
全仓库测试文件及测试用例全部通过，无破坏性变更。
