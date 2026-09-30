# 前端组件迁移与动效边界

## 目标

完成组件迁移后的 UI 修复，并把当前工作树中的只读项目保护、导出选项、分析任务控制和动效边界纳入正式行为。

## 范围与约束

- 保留现有弹窗 `frame={false}`、内外层 padding 收敛、章节树筛选编号和空项目编辑器修复。
- 旧项目的 `legacy_schema` 能力贯穿 DialogHost、工作台、分析、连接、任务中心和导出弹窗。
- 保留工作区全部现有改动；不回滚、不覆盖、不整理无关修改。
- 不增加依赖，不新增测试框架，不运行原执行计划明确禁止的 build 或 e2e。

## 执行步骤

1. **接通章节标题切换动效**
   - 在 `EditorHeader.tsx` 的章节标题变化时，实际触发 `transitions.css` 定义的退出/进入状态。
   - 标题初次显示、标题为空或不变时保持稳定；清理定时器，避免快速切章时旧状态覆盖新标题。
   - 尊重 `prefers-reduced-motion`，不改标题编辑、提交和取消行为。

2. **接通任务空状态揭示动效**
   - 在 `TaskCenterDrawer.tsx` 复用现有空状态内容和文案，补齐 CSS 所需的 skeleton/content 结构及 revealed 状态。
   - 保持非空任务列表和任务获取逻辑不变；不新增空状态文案。避免子元素因绝对定位丢失原有布局。

3. **补齐流式文本逐词出现效果**
   - 在 `StreamingText.tsx` 为每个非空白词接入实际的出现动画；保留词间空白、原文顺序、空文本返回 `null` 和现有光标效果。
   - 使用本地 CSS/现有样式能力，不新增依赖；动画需支持 reduced motion。

4. **清理 Appica 根路径导入和动效实现**
   - 将 `src/renderer` 中所有 `from '@appica/ui-react'` 改为对应组件的官方子路径导入。当前检出的文件有 `TaskRows.tsx`、`PromptBar.tsx`、`ApprovalCard.tsx`、`FloatingSelectionMenu.tsx`、`ChatWorkbenchDialog.tsx`、`CandidateReviewDialog.tsx`、`SpotlightTour.tsx`、`OutlineEditorDialog.tsx`、`TaskCenterDrawer.tsx`；执行前再次全量检索。
   - 清理剩余 `motion/react` 使用；标题切换、任务空状态、书架列表、流式文本和数字计数统一使用 `transitions.css`，所有动效支持 `prefers-reduced-motion`。

## 验收

- 标题变化能触发退出/进入过渡；任务空状态能触发 skeleton 到内容的揭示；流式文本各词有出现效果，空白不丢失。
- 全仓库不再有 `from '@appica/ui-react'` 根路径导入。
- 仅在无实际引用时移除 `clsx` 和 `tailwind-merge`；package 与 lockfile 一致。
- `pnpm typecheck` 和 `pnpm test` 通过。
- `git diff --check` 通过；汇报改动文件、测试结果和任何未解决项。
