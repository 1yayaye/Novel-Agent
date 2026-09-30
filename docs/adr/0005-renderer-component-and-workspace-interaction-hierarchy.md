# 0005: Renderer Component and Workspace Interaction Hierarchy

## Context
Novel Agent previously implemented all secondary views (outline, task center, knowledge base) as blocking full-screen modal overlays, which interrupted the writer's creative flow. We needed an accessible, robust component foundation that aligns with React 19, Tailwind CSS v4, and AI-native desktop interactions without maintaining an ad-hoc local copy of shadcn primitives.

## Decision
基础组件是 `@appica/ui-react`，主题 token 在 `src/renderer/styles/index.css`。对话框用 Appica Dialog，确认框用 Alert Dialog，Toast 用 Appica Toast，调用仍走 `useToast()`。右侧参考面板继续是工作台里的并排 aside，不用模态 Drawer。AI 表面只用 `src/renderer/components/ai/` 的 StreamingText、ThinkingState、PromptBar、ApprovalCard、TaskRows、SelectionActions。动效只使用 `transitions.css` 里的四段。HeroUI、Rare UI、beUI、shadcn 源码不引入。

## Consequences
- Authors can freely consult outlines, character dossiers, and monitor background tasks without losing editor focus.
- 核心 UI 基元完全由 `@appica/ui-react`（Base UI 生态）统一驱动，零自有 shadcn/Radix 散装代码负担。
- AI 交互层（流式输出、推理状态、输入栏、差异审批、任务状态、悬浮动作）通过 `src/renderer/components/ai/` 规范化为无额外重依赖的轻量壳组件。
- 动效收敛至 `transitions.css` 中的 4 段标准化过渡效果，确保视觉统一与高性能体验。
