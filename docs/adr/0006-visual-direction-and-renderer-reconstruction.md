# 0006: Visual Direction, Feature Slices, and Clean Slate Cutover

## Context
Following the design alignment session, the frontend requires a complete, human-centered redesign targeting fiction writers rather than technical users. We also resolved to restructure the codebase to eliminate monolithic files and execute a clean-slate cutover (Option B).

## Decision
1. **Visual Style**: Adopt **Warm Latte & Story Beats Card Flow** (温润拿铁与故事节拍流):
   - Palette: Soft warm latte, ivory, and warm stone backgrounds (`#FAF8F5`, `#F0EAE1`, `#E5DDD3`) with warm amber, deep forest, and terracotta accents.
   - Geometry: 14px friendly rounded corners, soft shadows, warm card surfaces.
   - Core UX: Floating bottom Action Dock (`ActionDock`: 大纲速查, 人物卡, 一键润色, 故事节拍, 字数统计) and right-side non-blocking Story Beats / Setting Drawer.
2. **Architecture**: Restructure `src/renderer/` into a **Feature-based Slice Architecture** (`components/ui/`, `features/shelf/`, `features/workbench/`, `features/editor/`, `features/drawer/`, `features/dialogs/`, `stores/`, `styles/`).
3. **Execution**: Execute as a clean-slate comprehensive rewrite followed by an atomic cutover, completely removing the legacy 101KB `styles.css` upon completion.

## Consequences
- The workbench shifts from a cold IDE feel to a cozy, inspiring, distraction-free literary creative workspace.
- State is decoupled into focused Zustand stores, eliminating 1,000-line props drilling.
- The cutover replaces legacy monolithic files cleanly without leaving residual transitional CSS technical debt.
