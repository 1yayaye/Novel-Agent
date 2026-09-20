# 0003 Shared Contract Modularization with Zero-Breaking Facade

## Context
`src/shared/project.ts` grew into a 1,875-line monolithic contract bus housing every Zod schema, IPC interface, and domain type across 50+ channels. Any minor type modification forced full Vite HMR reloads and broad re-compilation across main and renderer packages.

## Decision
We decompose `src/shared/project.ts` into domain-scoped contract modules under `src/shared/contracts/` (`chapter.ts`, `outline.ts`, `knowledge.ts`, `ai.ts`, `system.ts`), while retaining `src/shared/project.ts` as a re-exporting facade. New code imports specific domain contracts directly, while existing imports continue functioning seamlessly without churn.

## Status
accepted

## Considered Options
- **Leave `project.ts` Monolith Untouched**: Perpetuates bloated file size, slowed IDE completion, and high blast-radius edits.
- **Big-Bang Path Refactor**: Editing 50+ files to rewrite import paths creates massive merge risk and noisy git blame history.
- **Modularized Sub-contracts with Facade Re-export (Chosen)**: Delivers clear domain boundaries and scoped imports with zero breaking changes or file disruption.

## Consequences
- Clean modular structure without altering a single existing import statement.
- Future refactoring can update individual call-sites incrementally as needed.
