# Novel Agent Dual-Track Testing Infrastructure (TEST_INFRA.md)

## 1. Overview & Architectural Philosophy

Novel Agent adopts a decoupled **dual-track desktop architecture**:
1. **Existing Track (Electron)**: Main process (`src/main/`) + Preload (`src/preload/`) + React 19 / CodeMirror 6 frontend (`src/renderer/`).
2. **New Track (WinUI 3 + WebView2)**: Native Windows App SDK unpackaged desktop host (`src-winui/`) + Evergreen WebView2 container + decoupled Node.js Sidecar (`src/main/sidecar.ts`).

To guarantee 100% contract fidelity, zero regression on existing features, and deep opaque-box verification across both tracks, the testing infrastructure implements the **4-Tier Test Design Methodology** executed via a unified, zero-flakiness testing harness.

---

## 2. Test Frameworks & Execution Tooling

| Test Track | Primary Runner | Scope & Responsibilities | Execution Command |
|---|---|---|---|
| **Dual-Track 4-Tier E2E** | `vitest` (v4.1.10) | Opaque-box contracts, wire protocols, SQLite persistence, large doc stress, cancellation, crash recovery | `npx vitest run tests/e2e/dual-track/` |
| **Unit & Integration Baseline** | `vitest` (v4.1.10) | 65 existing test suites covering domain stores, parser, repositories, prompt macros, text counter | `pnpm test` |
| **Electron Shell E2E** | `playwright` (v1.62.1) | Electron window lifecycle, app protocol serving, CSP verification | `pnpm test:e2e` |
| **WinUI 3 Host Toolchain** | `dotnet / MSBuild` | C# .NET 8 unpackaged project build, XAML compilation, high-DPI manifest verification | `dotnet build src-winui/NovelAgent.WinUI.csproj -c Release` |
| **Static Typing & Contracts** | `tsc` (v7.0.2) | Full workspace strict typecheck with zero emitted warnings | `pnpm typecheck` |

---

## 3. The 4-Tier Test Design Methodology & Coverage Matrix

The dual-track test suite is structured into 4 distinct verification tiers located under `tests/e2e/dual-track/`:

```
tests/e2e/dual-track/
├── harness.ts                     # Shared isolated test environment, mock LLM server, & bridge simulators
├── tier1-feature-coverage.spec.ts # Tier 1: Core Feature Coverage (30 tests)
├── tier2-boundary-corner.spec.ts  # Tier 2: Boundary & Corner Cases (25 tests)
├── tier3-cross-feature.spec.ts    # Tier 3: Cross-Feature Combinations (6 tests)
└── tier4-real-world.spec.ts       # Tier 4: Real-World Application Scenarios (5 tests)
```

### Tier 1: Core Feature Coverage (30 Tests)
Covers all 6 core functional pillars (>=5 tests per feature):
1. **WinUI 3 Launch, Loading & Window Manifest (5 tests)**:
   - `winui-01`: Unpackaged project file configuration (`OutputType=WinExe`, `WindowsPackageType=None`, `UseWinUI=true`, .NET 8).
   - `winui-02`: High-DPI manifest with PerMonitorV2 awareness.
   - `winui-03`: Windows 11 Mica material (`MicaBackdrop`) & custom immersive titlebar configuration.
   - `winui-04`: WebView2 container virtual host mapping (`https://novel-agent/` -> `out/renderer`) & profile directory isolation.
   - `winui-05`: Chromium flags for DirectWrite ClearType & CJK rendering protection.
2. **PlatformBridge Contract RPC (5 tests)**:
   - `rpc-01`: Valid request dispatch returns typed DTO conforming to shared Zod schema.
   - `rpc-02`: Invalid input schema rejected with `VALIDATION_ERROR` code.
   - `rpc-03`: Concurrent interleaved requests correlated accurately by unique correlation ID.
   - `rpc-04`: Push event routing (`candidate:delta`, `chat:delta`, `task:progress`) and safe unsubscription.
   - `rpc-05`: Domain error codes (`PROJECT_NOT_OPEN`, `DATABASE_ERROR`) propagated without masking.
3. **Node.js Sidecar Lifecycle & Healthcheck (5 tests)**:
   - `sidecar-01`: JSON-RPC 2.0 handshake ping/pong healthcheck.
   - `sidecar-02`: Stdio stream separation (clean NDJSON on stdout, logs to stderr).
   - `sidecar-03`: Windows Job Object binding (`JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`) semantics.
   - `sidecar-04`: Graceful shutdown signal handling & resource teardown.
   - `sidecar-05`: Standard JSON-RPC -32601 Method Not Found error response.
4. **SQLite Database Persistence (5 tests)**:
   - `sqlite-01`: `.novelproj` database initialization with WAL journal mode & foreign keys.
   - `sqlite-02`: Read-only version probe before write (`PRAGMA user_version`).
   - `sqlite-03`: Atomic chapter CRUD and optimistic version counter incrementing.
   - `sqlite-04`: FTS5 trigram Chinese full-text search index synchronization and query.
   - `sqlite-05`: Transaction rollback on failure maintaining database consistency.
5. **CodeMirror 6 Editor Load & Save (5 tests)**:
   - `cm6-01`: Lightweight chapter header listing vs full content retrieval on demand.
   - `cm6-02`: Optimistic version conflict detection (`VERSION_CONFLICT`).
   - `cm6-03`: Allocation-free character counter integration for editor word counts.
   - `cm6-04`: Automatic ordinary snapshot generation prior to major text modifications.
   - `cm6-05`: Debounced save flushes mutations without dropping edits.
6. **Dual-Track CLI Scripts & Toolchain (5 tests)**:
   - `cli-01`: Package.json non-polluting dual-track scripts definitions.
   - `cli-02`: Baseline Electron scripts (`pnpm dev`, `pnpm build`, `pnpm test`) 100% preserved.
   - `cli-03`: .NET 8 build command generator with platform arguments.
   - `cli-04`: Renderer distribution folder usable by both Electron and WebView2.
   - `cli-05`: Unpackaged distribution directory isolation.

### Tier 2: Boundary & Corner Cases (25 Tests)
Covers 5 boundary categories (>=5 tests per category):
1. **Large Documents & Extreme Payloads (5 tests)**:
   - 100,000+ Chinese character document loading and character count latency < 50ms.
   - Myers diff computation threshold on large strings (>3000 chars).
   - NDJSON multi-megabyte payload buffer chunk fragmentation handling.
   - 200+ chapters bulk listing without out-of-memory or payload bloat.
   - Chapter split and merge preserving Unicode surrogate boundaries.
2. **Special CJK Characters, Unicode & Encodings (5 tests)**:
   - Rare CJK ideographs (龘, 鱻, 龖, 𠮷) and astral plane emojis preserved in SQLite.
   - Full-width Chinese punctuation marks (《》、“”、……、——) search fidelity.
   - UTF-8 with BOM and GB18030 novel sources import auto-detection.
   - Non-printable ASCII control characters sanitization.
   - CSS DirectWrite subpixel ClearType antialiasing rules.
3. **Rapid Consecutive Saves & Optimistic Concurrency (5 tests)**:
   - Burst of 20 rapid successive saves with version counter checks.
   - Concurrent writes serialized cleanly without `SQLITE_BUSY` errors.
   - Outdated version write immediately rejected with `VERSION_CONFLICT`.
   - Debounced save preserves trailing keystrokes without loss.
   - Simultaneous chapter save and background FTS index synchronization.
4. **Timeout, Cancellation & Abort (5 tests)**:
   - Pending RPC request map cleanup upon timeout.
   - AI creation stream cancellation halts token delivery and marks candidate cancelled.
   - Chat session stream cancellation frees locks promptly.
   - Analysis task cancellation without leaving dirty checkpoints (AGENT_LEARNINGS).
   - Aborted stream reader terminates cleanly without unhandled rejections.
5. **Offline & Error Responses (5 tests)**:
   - Unreachable LLM provider returns `CONNECTION_FAILED` without leaking credentials.
   - Non-existent or corrupted project file returns `DATABASE_ERROR`.
   - Malformed NDJSON over stdio returns JSON-RPC -32700 Parse error.
   - Untrusted sender frame IPC invocation returns `UNTRUSTED_SENDER`.
   - Read-only project rejects mutations with `PROJECT_READ_ONLY`.

### Tier 3: Cross-Feature Combinations (6 Tests)
Pairwise full-chain integration flows:
- `pair-01`: Create Project -> Load Chapter -> CodeMirror Edit -> Debounced Save -> Direct SQLite Verification.
- `pair-02`: Project Open -> Chapter Edit -> AI Stream Generation -> Review Diff Hunks -> Apply Candidate -> Auto Snapshot.
- `pair-03`: AI Stream in-flight -> User Cancels -> Editor State Preserved -> Subsequent Continuation Completes.
- `pair-04`: Chapter Content Edit -> Baseline Snapshot -> Major Rewrite -> Restore Snapshot -> FTS Re-Index.
- `pair-05`: PlatformBridge RPC -> Create Knowledge Entry -> Trigger Hybrid Search Sync -> Keyword Discovery.
- `pair-06`: Chat Session Lifecycle -> Message Append -> Token Accumulation -> Session Compaction & Summary.

### Tier 4: Real-World Application Scenarios (5 Tests)
End-to-end user workflows:
- `scenario-01`: Complete Novel Import Workflow (multi-chapter TXT import, auto-splitting, first chapter editing).
- `scenario-02`: Full Chapter Writing & AI Co-Creation Loop (outline -> draft -> AI streaming -> review & apply).
- `scenario-03`: Mid-Session Crash & Abnormal Termination Recovery (uncheckpointed WAL recovery & schema probe).
- `scenario-04`: High-Watermark Backup Retention & Rotation (retains limit, rotates oldest, avoids deletion race condition per AGENT_LEARNINGS).
- `scenario-05`: Multi-Chapter Rolling Analysis & Step Interruption State Protection (reads completed step 0 checkpoint, ignores failed step 1 dirty state per AGENT_LEARNINGS).

---

## 4. Test Harness Architecture (`tests/e2e/dual-track/harness.ts`)

The test harness provides reproducible test fixtures isolated from the host environment:
1. **`createDualTrackTestEnv()`**:
   - Generates isolated temporary directories (`tempDir`, `dataDir`, `novelsDir`).
   - Wires pure Node.js service instances: `ProjectStore`, `ChapterRepository`, `KnowledgeRepository`, `CreativeRepository`, `SearchIndex`, `ModelGateway`, `ContextAssembler`, `CandidateService`, `CreationRunner`, `ChatService`, `AnalysisRunner`.
   - Boots in-memory `MockLlmServer` with configurable SSE streaming and error simulation endpoints.
2. **`WebView2BridgeSimulator`**:
   - Emulates the CoreWebView2 `postMessage` / `onmessage` wire protocol:
     - Request: `{ type: 'rpc_request', id: string, channel: string, payload?: unknown }`
     - Response: `{ type: 'rpc_response', id: string, ok: true, value: unknown }` | `{ ok: false, error: ... }`
     - Push Event: `{ type: 'event', channel: string, payload: unknown }`
3. **`SidecarJsonRpcSimulator`**:
   - Emulates the Stdio NDJSON JSON-RPC 2.0 communication between WinUI 3 host and Node.js Sidecar:
     - Request: `{"jsonrpc":"2.0","id":"...","method":"...","params":{...}}`
     - Response: `{"jsonrpc":"2.0","id":"...","result":{...}}`
     - Notification: `{"jsonrpc":"2.0","method":"event","params":{...}}`
4. **`createTestProject(env, title)`**:
   - Helper guaranteeing compliant `.novelproj` creation with valid UUID destination, metadata, and description.

---

## 5. Execution Guide & CI Commands

### Run Full Dual-Track Test Suite (All 66 Tests)
```bash
npx vitest run tests/e2e/dual-track/
```

### Run Specific Test Tiers
```bash
# Tier 1 only (30 tests)
npx vitest run tests/e2e/dual-track/tier1-feature-coverage.spec.ts

# Tier 2 only (25 tests)
npx vitest run tests/e2e/dual-track/tier2-boundary-corner.spec.ts

# Tier 3 only (6 tests)
npx vitest run tests/e2e/dual-track/tier3-cross-feature.spec.ts

# Tier 4 only (5 tests)
npx vitest run tests/e2e/dual-track/tier4-real-world.spec.ts
```

### Baseline Regression Assurance
```bash
# Verify existing 65 suites (294 tests) pass with zero baseline degradation
pnpm test

# Verify full static type safety
pnpm typecheck
```
