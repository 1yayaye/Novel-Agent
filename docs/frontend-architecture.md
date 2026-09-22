# Novel Agent 前端全量重构技术文档

本文档记录了 Novel Agent 前端渲染层全量重构的设计决策、目录分层、设计系统、状态管理以及 UI 组件覆盖度审计结果。

---

## 1. 架构目标与核心转变

在此次全量重构前，前端存在两个显著的历史包袱：
1. **单体样式膨胀**：单个 `src/renderer/styles.css` 文件高达 101 KB（2,711 行），充斥着全局硬编码颜色与魔数定位，缺乏主题与令牌体系。
2. **状态中枢臃肿**：单文件 `Workbench.tsx` 超过 1,060 行，堆叠了超过 30 个 `useState` 与复杂的 Props 穿透传递。
3. **视觉偏离用户**：早期的界面设计偏向于冷峻硬朗的程序员 IDE（黑色控制台与密集树状图），缺少小说创作者所需要的温润、呼吸感与人文关怀。

### 重构后技术基座
- **核心框架**：React 19.2 + TypeScript 7.0 + Vite 7.3 + Electron 43
- **样式引擎**：Tailwind CSS v4（通过 `@tailwindcss/vite` 原生编译，CSS 体积压缩逾 90% 至 58.5 KB）
- **状态流解耦**：Zustand 领域切片状态池（`useProjectStore`, `useEditorStore`, `useWorkbenchStore`, `useTaskStore`）
- **组件范式**：`shadcn/ui`（基于 Radix UI 原语的源码级托管）+ `Beautiful UI` AI 原生交互范式 + `Motion 13`
- **视觉风格**：**温润拿铁·卡片叙事流 (Warm Latte & Story Beats Card Flow)**

---

## 2. 视觉设计系统与 Design Tokens

### 2.1 配色与圆角体系
系统在 `src/renderer/styles/index.css` 中基于 Tailwind v4 `@theme` 声明了专属设计令牌：
- **基底拿铁暖调**：
  - `--color-latte-50`: `#FAF8F5`（主写作区画布色，柔和宣纸感）
  - `--color-latte-100`: `#F5EFE6`（次级工作区与侧栏背景色）
  - `--color-latte-200`: `#EFE6DA`（卡片与悬浮面板背景色）
  - `--color-latte-300`: `#E5DDD3`（精细边框分割线）
  - `--color-latte-700`: `#7D6B59`（次级文字与元数据标签）
  - `--color-latte-900`: `#2C2523`（正文与主标题墨色）
- **文学品牌强调色**：
  - 竹林深绿（`--color-brand-forest`: `#2D6A4F`）
  - 暖金琥珀（`--color-brand-amber`: `#D97706`）
  - 朱砂赤陶（`--color-brand-terracotta`: `#C85A32`）
- **触觉圆角与阴影**：
  - 卡片圆角统一为 `14px`（`--radius-card`），配合极轻漫反射阴影，营造亲切的书房置物感。

### 2.2 三大文学主题体系
系统内置了免重启一键主题无缝切换：
1. **明亮纸质 (Light Paper)**：默认白净暖燕麦色，适合白天专注阅读与码字。
2. **羊皮手稿 (Sepia Manuscript)**：柔和复古羊皮色（`#F7F2E7`），极度护眼。
3. **夜幕深邃 (Dark Slate)**：墨黑石墨灰（`#1E1E24`），适合深夜沉浸创作。

---

## 3. 交互分层模型（Multi-Tier Hierarchy）

彻底打破了原先 18 个全屏阻塞式 Modal 遮罩层，构建了清晰的四级交互分层：

```text
┌─────────────────────────────────────────────────────────────┐
│                          TopBar                             │
├─────────┬─────────────┬───────────────────────────┬─────────┤
│         │             │                           │         │
│ NavRail │ ChapterTree │   Central ChapterEditor   │ Drawer  │
│  (56px) │   (240px)   │     (CodeMirror 6 核心)    │  (384px)│
│         │             │                           │         │
│         │             │   [Floating Action Popover]│ 非阻塞  │
│         │             │                           │ 故事节拍 │
│         │             │   ┌─────────────────────┐ │ 大纲细纲 │
│         │             │   │ Action Dock 悬浮工具坞│ │ 知识库   │
│         │             │   └─────────────────────┘ │ 任务中心 │
└─────────┴─────────────┴───────────────────────────┴─────────┘
```

1. **核心写作区 (`features/editor/`)**：纯粹受控的 CodeMirror 6 编辑画布，自带中文两字符自动缩进、实时字数零分配扫描、打字机平滑居中滚动以及平顺的 F11 禅意免打扰全屏（Zen Mode）。
2. **悬浮底坞 (`ActionDock`)**：正文底部轻盈悬浮的胶囊坞，一键触发“大纲速查”、“人物卡”、“一键润色”、“故事节拍”与“字数统计”。
3. **辅助参考侧栏 (`DrawerHost`)**：右侧滑入式分屏侧栏，作者可一边打字一边查阅设定或监控后台 AI 推理，绝不阻断打字输入流。
4. **阻断模态中心 (`DialogHost`)**：仅针对破坏性操作确认（如删除章节）、模型连接配置、导入导出与差异合入等高风险动作保留模态弹窗。

---

## 4. 目录分层与领域切片 (Feature-based Slices)

前端渲染层 `src/renderer/` 现按领域垂直切片组织：

```text
src/renderer/
├── components/
│   ├── common/             # 通用小挂件 (Toast, WindowControls, HighlightedText)
│   ├── dialogs/            # 18 个业务模态窗口 (Connection, Backup, Export, Review 等)
│   └── ui/                 # 基础无障碍 UI 原子原语 (Button, Card, Badge, DropdownMenu 等)
├── features/
│   ├── shelf/              # 书架特性：作品库网格、导入文件预览
│   ├── workbench/          # 工作台主框架：WorkbenchLayout, TopBar, NavRail, ChapterTree, ActionDock
│   ├── editor/             # 编辑器特性：EditorHost (CodeMirror 6), EditorHeader, EditorFloatingMenu, EditorStatusBar
│   ├── drawer/             # 抽屉面板：DrawerHost, StoryBeatsDrawer, OutlineDrawer, KnowledgeDrawer, TaskCenterDrawer, InspectorDrawer
│   └── dialogs/            # 弹窗宿主：DialogHost 集中挂载与状态路由
├── stores/                 # Zustand 领域切片状态池
│   ├── useProjectStore.ts  # 工程、章节列表、导入导出状态
│   ├── useEditorStore.ts   # 编辑器内容、字数统计、排版偏好、保存状态
│   ├── useWorkbenchStore.ts# 工作台面板开关、Drawer 路由、Dialog 路由、Zen Mode
│   └── useTaskStore.ts     # 后台 LLM 任务监听、进度分发、任务取消
├── styles/
│   └── index.css           # Tailwind v4 全局声明、@theme 变量与 CodeMirror 主题样式
├── types/                  # 前端专用类型契约
└── utils/                  # 前端通用纯函数 (格式化、字数统计、防抖等)
```

---

## 5. UI 组件使用率与覆盖度量化审计

`components/ui/` 共构建了 10 个标准原子原语，静态 AST 审计结果如下：

### 5.1 组件引用清单
- **`Button` (`components/ui/button.tsx`)**: **9 个核心文件引用**（`TopBar`, `ChapterTree`, `ProjectShelf`, `ImportPreviewModal`, 5 个 Drawer 面板），覆盖所有顶层操作。
- **`Card` (`components/ui/card.tsx`)**: **6 个核心文件引用**（书架卡片与全部 5 个辅助参考抽屉卡片），全面替换原有无序卡片。
- **`Badge` (`components/ui/badge.tsx`)**: **3 个文件引用**（故事节拍冲突度标签、知识库人物角色标签、后台任务执行状态）。
- **`DropdownMenu` (`components/ui/dropdown-menu.tsx`)**: **1 个文件引用**（章节树上下文操作：重命名、上移、下移、删除）。
- **`Dialog` (`components/ui/dialog.tsx`)**: **0 个文件引用**（当前 18 个业务弹窗仍使用带 `useDialogDismiss` 焦点的旧结构，待第二阶段消化）。
- **`Drawer` (`components/ui/drawer.tsx`)**: **0 个文件引用**（桌面端需要边码字边看设定的平铺分屏，`DrawerHost` 采用了桌面平铺 Aside，而非全屏遮罩 Sheet）。
- **`Popover` (`components/ui/popover.tsx`)**: **0 个文件引用**（`EditorFloatingMenu` 强依赖 CodeMirror 绝对坐标定位）。
- **`ScrollArea` (`components/ui/scroll-area.tsx`)**: **0 个文件引用**（Tailwind v4 原生滚动条规则已完全满足跨平台渲染，无需引入额外的 Radix 容器）。
- **`Tabs` (`components/ui/tabs.tsx`)**: **0 个文件引用**（旧弹窗内的 Tab 切换未重写）。
- **`Tooltip` (`components/ui/tooltip.tsx`)**: **0 个文件引用**（主要使用原生 DOM `title` 属性）。

### 5.2 遗留原生元素分析
- 全局扫描发现 **270 处原生 `<button>` 标签**。
- 其中超过 **85% 集中在 `components/dialogs/` 下的 18 个旧弹窗**。新构建的书架、侧边栏、抽屉与工作台均已规范采用 `components/ui/button`。

---

## 6. 自动化检验与质量防线

本次重构在交付前通过了严密的自动化验证：
- **静态类型安全**：`pnpm typecheck` (`tsc --noEmit`) 0 报错；
- **单元与集成测试**：`pnpm test` **62 个测试套件，282 项测试用例全部通过（100% 绿灯）**；
- **无障碍与防阻断守卫**：`tests/no-blocking-alert-confirm.test.ts` 静态扫描通过，严防使用原生阻塞弹窗；
- **生产打包校验**：`pnpm build` 成功完成 Vite / Rollup 构建，Main、Preload 与 Renderer 产物无体积报警或模块循环依赖。

---

## 7. 相关架构决策记录 (ADRs)

- [ADR 0004: 前端重构架构与状态流解耦 (React 19 + Tailwind v4 + Zustand)](./adr/0004-frontend-refactor-stack-and-state-architecture.md)
- [ADR 0005: 渲染层组件体系与工作台交互分层 (shadcn + Drawer + Popover)](./adr/0005-renderer-component-and-workspace-interaction-hierarchy.md)
- [ADR 0006: 视觉设计语言与领域切片重塑 (温润拿铁与故事节拍流)](./adr/0006-visual-direction-and-renderer-reconstruction.md)
