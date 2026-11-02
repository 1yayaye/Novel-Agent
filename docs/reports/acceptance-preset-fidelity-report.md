# 酒馆预设保真导入与装配最终验收报告

> **验收时间**：2026-10-16  
> **验收角色**：验收测试子代理（Acceptance Tester）  
> **被测特性**：消除预设强制纠偏、全面遵循原生编排（Prompt Orchestration Fidelity）  
> **代码工作区**：`e:\小说工作流\小说`  
> **验收结论**：**通过（PASS）**

---

## 一、 验收总体结论与核心指标概览

| 验收维度 | 验收目标 | 实测结果 | 结论 |
| :--- | :--- | :--- | :---: |
| **虚假插槽注入率** | 0%（不再强制 push 缺失的资料插槽） | **0%**（4个真实预设与12项标准预设均零注入） | **PASS** |
| **源预设拓扑还原度** | 100% 还原源 `prompts` 与 `prompt_order` | **100%**（源块数与转换块数严格 1:1 对齐） | **PASS** |
| **Post-History 近因效应** | 严格排在正文历史对话（Chat History）之后 | **严格位于所有历史正文消息之后** | **PASS** |
| **Kemini 倒序原生保真** | Agent Task（order 34）排在 History（order 35）之前 | **Order 34 < 35，编译消息中任务严先于历史** | **PASS** |
| **智脑-Z 尾部输入保真** | 历史排在 `【本轮 {{user}} 的输入】` 之前 | **Order 60 < 74，编译消息中历史严先于尾部输入** | **PASS** |
| **In-Chat 深度保真** | `depth` 与 `position` 不被篡改成 0 / relative | **精准保留并在历史流倒数第 N 轮正确穿插** | **PASS** |
| **全量自动化回归** | 零失败、零回归 | **78/78 测试套件通过，461/461 测试项通过** | **PASS** |
| **类型健全度** | TypeScript 静态编译 0 报错 | **`tsc --noEmit` 0 错误通过** | **PASS** |

---

## 二、 详细验收用例执行记录

### 1. 测试用例 1：酒馆默认预设（Default SillyTavern Preset）结构还原度与 Post-History 验收

- **测试对象**：构造用户提供的酒馆标准 12 项拓扑预设：
  1. `Main Prompt` (`main`, system)
  2. `World Info (before)` (`worldInfoBefore`, system)
  3. `Persona Description` (`personaDescription`, system)
  4. `Char Description` (`charDescription`, system)
  5. `Char Personality` (`charPersonality`, system)
  6. `Scenario` (`scenario`, system)
  7. `Enhance Definitions` (`enhanceDefinitions`, system)
  8. `NSFW Prompt` (`nsfwPrompt`, system)
  9. `World Info (after)` (`worldInfoAfter`, system)
  10. `Chat Examples` (`dialogueExamples`, system)
  11. `Chat History` (`chatHistory`, user)
  12. `Post-History Instructions` (`postHistoryInstructions`, system)
- **拓扑还原度验证**：
  - 导入解析后 `preset.blocks` 数组长度**严格等于 12**，未追加任何“设定库资料插槽/会话与正文历史插槽/作者任务与指令插槽”等虚构块；
  - 顺序拓扑严格保持 0 到 11 的自然编排。
- **Post-History 装配与近因效应验证**：
  - 传入正文历史（`materials.history` 包含 2 轮正文）与作者指令（`instruction`）；
  - 编译装配后的 `messages` 序列结构为：
    ```
    [System 引导提示词...]
    ➔ [材料设定...]
    ➔ [Chat History 历史正文轮次 1]
    ➔ [Chat History 历史正文轮次 2]
    ➔ [Post-History Instructions 强约束指令]
    ➔ [作者任务与写作指令]
    ```
  - **断言结果**：`Post-History Instructions` 索引（`postHistIdx`）严格大于历史正文末轮索引（`history2Idx`），充分发挥大模型近因效应（Recency Bias），杜绝了被历史长文本淹没的问题。

---

### 2. 测试用例 2：下载目录与测试目录四大真实预设导入与拓扑保真验收

测试覆盖了 `$HOME/Downloads/` 与 `tests/fixtures/tavern-presets/` 下的 4 款工业级真实酒馆预设：

| 预设文件名 | 源 Prompt 块数 | 转换后 Block 块数 | 启用块数 | 虚构插槽追加数 | 原生编排关键特征断言 | 验收状态 |
| :--- | :---: | :---: | :---: | :---: | :--- | :---: |
| **`[主预设] V19.7.3 狐神抚 · 毓忻.json`** | 220 | 220 | 15 | **0** | 忠实保留多层正则与玄狐宏，无强行篡改 | **PASS** |
| **`智脑-Z（10.1）-2.json`** | 92 | 92 | 53 | **0** | `chatHistory` (order 60) < `input_emphasis` (order 74)，历史在尾部输入前 | **PASS** |
| **`Izumi 1002.json`** | 231 | 231 | 27 | **0** | 零冗余虚假块，27个有效块拓扑一致 | **PASS** |
| **`Kemini_Dramatron_v3.1.json`** | 55 | 55 | 18 | **0** | `Agent Task` (order 34) < `Chat History` (order 35)，任务严先于历史 | **PASS** |

#### 深度验证重点：
1. **`Kemini_Dramatron_v3.1.json` 原生顺序保真**：
   - 原预设中设计者有意将 `Agent Task` 放在 `Chat History` 之前；
   - 验证：导入后 `taskBlock.order (34) < historyBlock.order (35)`；在装配输出的消息流中，`Task` 指令内容在 `Chat History` 正文之前，**未被系统擅自移位或挪至末尾**。
2. **`智脑-Z（10.1）-2.json` 尾部输入与规则保真**：
   - 包含特定宏清洗后的 `【本轮 作者 的输入】` 位于 block 74；
   - 验证：在装配输出的消息流中，历史对话（order 60）严格早于 `【本轮 作者 的输入】`，尾部收尾规则正常在末端生效。

---

### 3. 测试用例 3：In-Chat 穿插与 Depth 深度不被抹平验收

- **测试对象**：
  - 构造包含 `injection_position: 'in_chat'`（或 `1`）以及 `injection_depth: 4` 与 `injection_depth: 2` 的复杂提示词结构。
- **导入保真验证**：
  - 转换后对应的 Block 属性严格为 `position: 'in_chat'`、`depth: 4` 与 `depth: 2`；
  - 绝未被退化或篡改为 `position: 'relative'` 或 `depth: 0`。
- **装配动态计算与精准穿插验证**：
  - 传入 6 轮历史消息（`H0`、`H1`、`H2`、`H3`、`H4`、`H5`，其中 `H5` 为最新一条）；
  - 装配算法执行：
    - `depth: 4` 提示词精准插在 `H1` 与 `H2` 之间（即倒数第 4 条 `H2` 之前）；
    - `depth: 2` 提示词精准插在 `H3` 与 `H4` 之间（即倒数第 2 条 `H4` 之前）；
    - 历史对话完整且先后顺序严丝合缝。

---

### 4. 测试用例 4：全量自动化回归测试

执行项目完整测试命令 `npm test` 与 `npm run typecheck`：
- **测试套件总数**：78 passed / 78 total (100%)
- **测试用例总数**：461 passed / 461 total (100%)
- **测试执行耗时**：13.13s
- **重点回归模块表现**：
  - `tests/acceptance-preset-fidelity.test.ts` (8 tests) -> 全部通过
  - `tests/tavern-preset.test.ts` (15 tests) -> 全部通过
  - `tests/stage-prompt-slots.test.ts` (12 tests) -> 全部通过
  - `tests/presets-eval.test.ts` (9 tests) -> 全部通过
  - `tests/preset-conversion-real.test.tsx` (7 tests) -> 全部通过
  - `tests/preset-conversion-frontend.test.tsx` (9 tests) -> 全部通过
- **静态类型检查**：`tsc --noEmit` 耗时 3.9s，0 错误，类型系统完全自洽。

---

## 三、 结论

编码子代理实施的“消除预设强制纠偏、全面遵循原生编排”已达到生产级保真标准：
1. 完全消除了过往实现中强行注入的虚构插槽；
2. 忠实保留了酒馆原始拓扑顺序（无论 Task 在 History 之前还是之后，无论 Post-History 如何排布）；
3. 准确实现了 `in_chat` 与 `depth` 动态穿插计算；
4. 全量回归测试 100% 绿灯。
本项验收通过。
