# 0001 Soft Invalidation and Report Snapshot Binding

## Context
When authors edit chapter text, `invalidateContent` previously set `book_synopsis`, `literary_report`, and `book_outline` to `stale`, wiping out expensive multi-chapter AI analysis results whenever a single typo was fixed.

## Decision
We decouple chapter-level micro-caches from book-level macro-analysis. Micro-caches (`content_chunk`, `chapter_summary`, `candidate`) remain marked `stale` on edits. Macro-assets (`literary_report`, `book_synopsis`, `book_outline`) are bound to the chapter revision snapshots present when they were computed, remaining valid as historical analytical artifacts. The UI will compute an `Outdated Delta` to prompt the author for optional refreshes rather than destroying existing reports.

## Status
accepted

## Considered Options
- **Hard Stale Everything (Previous Implementation)**: Aggressively invalidated all summaries and reports upon any edit, wasting user tokens and destroying visibility into previous analyses.
- **Pure Soft Outdated with no version binding**: Ignored revisions entirely, leaving reports potentially desynchronized without tracking the gap.
- **Snapshot-Bound Analysis with Soft Outdated Delta (Chosen)**: Preserves existing token investments, tracks chapter revisions, and gives authors explicit control over when to re-analyze.

## Consequences
- Single-character edits no longer wipe macro-level reports or outline confirmation states.
- Analysis features must persist the array of chapter version IDs (`target_versions_json`) evaluated during report generation.
