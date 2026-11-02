# 0004: Frontend Refactoring Stack and State Architecture

## Context
The legacy renderer accumulated a 2,700-line monolithic `styles.css` and a 1,060-line `Workbench.tsx` managing over 30 ad-hoc `useState` hooks with deep props drilling. We required a modern, maintainable styling and state architecture for our local-first Electron desktop novel workbench without compromising React 19 compatibility.

## Decision
We adopt **Tailwind CSS v4** with CSS variable design tokens to replace the monolithic stylesheet, and **Zustand** domain slice stores (`useWorkbenchStore`, `useEditorStore`, `useProjectStore`, `useTaskStore`) to decouple state from `Workbench.tsx`. The foundation remains React 19 + TypeScript + Vite with CodeMirror 6 for rich text editing.

## Consequences
- Single 101KB `styles.css` will be completely eliminated in favor of atomic utility classes and theme tokens.
- UI components will subscribe directly to specific Zustand slices, preventing unnecessary re-renders in the central editor canvas.
- Theme switching (Light Paper, Dark Slate, Sepia Manuscript) becomes a first-class token switch without runtime CSS overhead.
