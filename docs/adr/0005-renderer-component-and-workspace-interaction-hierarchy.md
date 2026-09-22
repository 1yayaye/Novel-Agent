# 0005: Renderer Component and Workspace Interaction Hierarchy

## Context
Novel Agent previously implemented all secondary views (outline, task center, knowledge base) as blocking full-screen modal overlays, which interrupted the writer's creative flow. We also needed an accessible, customizable component foundation that aligns with React 19, Tailwind CSS v4, and AI-native desktop interactions.

## Decision
We adopt `shadcn/ui` (Radix primitives) located in `src/renderer/components/ui/` combined with `Beautiful UI` patterns for streaming thoughts and human-in-the-loop candidate acceptance. Workspace interactions are partitioned into a multi-tier hierarchy:
1. **Core Writing Canvas**: Distraction-free CodeMirror 6 with modularized extensions.
2. **Slide-over Drawers**: Non-blocking reference panels for Outline, Knowledge Base, and Task Center.
3. **Floating Popovers**: Cursor-anchored AI polish and inline review cards.
4. **Modal Dialogs**: Strictly reserved for destructive confirmations, imports, and system settings.

## Consequences
- Authors can freely consult outlines, character dossiers, and monitor background tasks without losing editor focus.
- Eliminates 18 ad-hoc full-screen modal overlays from `Workbench.tsx`.
- Keeps UI source code 100% owned and auditable without heavy opaque third-party library dependencies.
