# 前端组件库替换执行单

按顺序做。不要并行开第二套按钮、弹层或表单。不要新增界面来换覆盖率。做完一步再做下一步。每步结束跑文末的检查命令，失败就停在该步修完。

仓库：`E:\小说工作流\小说`。包管理器：pnpm。渲染进程是 React 19 + Tailwind v4，样式入口是 `src/renderer/styles/index.css`。

## 固定决定

基础组件只用 `@appica/ui-react`（Base UI）。文档以 `https://appica.dev/ui/components/react/<slug>.md` 的 API 表为准。表里没有的 prop 不要写。

不安装、不复制这些库的组件：HeroUI、Rare UI、beUI、shadcn/ui。不运行 `npx shadcn add`。不创建 `components.json`。不安装 `@appica/icons-react`。图标继续用 `lucide-react`。

`DrawerHost` 保持现在的并排 `<aside>`（编辑区不被遮罩盖住）。不要换成 Appica Drawer。Appica Drawer 默认是模态浮层，会挡住正文。

CodeMirror 正文、选区坐标、快捷键绑定不要改。`WindowControls.tsx` 里的三个系统按钮不要改。

`src/renderer/hooks/useDialogDismiss.ts` 不要删。`tests/dialog-dismiss.test.ts` 直接测这个 hook。

`src/renderer/components/editor/Inspector.tsx` 没有任何 import，不要改。

`src/renderer/styles/index.css` 里已有的这些选择器必须原样保留，测试在读它们：`.dialog-header`、`.dialog-footer`、`.icon-button`、`.text-button`、`.primary-button`、`.workflow-guide-banner`、`.outline-empty-flow`、`.knowledge-body`、`.candidate-review-body`、`.chat-layout`、`.chat-input-box`、`.chat-input-textarea`，以及 `grid-template-columns: 260px minmax(0, 1fr)`。

## 1. 安装并锁住浅色主题

在仓库根目录：

```bash
pnpm add -D @appica/ui-react
```

`src/renderer/styles/index.css` 第一行现在是 `@import "tailwindcss";`。改成：

```css
@import "tailwindcss";
@import "@appica/ui-react/styles.css";

@source "../../../node_modules/@appica/ui-react/dist";
```

`@source` 相对的是这个 css 文件。它在 `src/renderer/styles/`，到仓库根是三层 `../`。不要写成两层，也不要写成 `@source "@appica/ui-react"`。不要再导入 `@appica/ui-react/css`。

紧接着写 token。已有的 `@theme` 拿铁色变量保留。在 `:root` 增加（没有 `:root` 就新建）：

```css
:root {
  --background: #faf8f5;
  --background-subtle: #f5efe6;
  --background-muted: #efe6da;
  --foreground: #54473b;
  --foreground-muted: #7d6b59;
  --foreground-subtle: #baa997;
  --foreground-intense: #2c2523;
  --border: #e5ddd3;
  --border-strong: #dacdbe;
  --primary: #2d6a4f;
  --primary-strong: #24583e;
  --primary-soft: #e8f3ee;
  --primary-foreground: #ffffff;
  --focus-ring-primary: #2d6a4f4d;
  --radius: 0.875rem;
}
```

这些是 Appica 的原始 token（`--primary`），不是 `--color-primary`。错误色、成功色、警告色不要改。

`src/renderer/main.tsx`：用 `ThemeProvider` 包住 `<App />`，仍留在 `<StrictMode>` 里。

```tsx
import { ThemeProvider } from '@appica/ui-react/providers/theme-provider'
```

打开 `https://appica.dev/ui/docs/react/theme-provider.md`。如果有 `forcedTheme`，设为 `"light"`。没有的话用该页写明的强制浅色 prop。不要跟系统深色模式走。

## 2. 替换已经在用的本地组件

导入一律走子路径，例如 `import { Button } from '@appica/ui-react/button'`。不要 `from '@appica/ui-react'`。

打开对应 `.md` 后再改。对照表：

| 现在 | 改为 |
|---|---|
| `components/ui/button` 的 `Button` | `@appica/ui-react/button` |
| `badge` | `@appica/ui-react/badge` |
| `card` | `@appica/ui-react/card` |
| `dialog` | `@appica/ui-react/dialog` |
| `dropdown-menu` | `@appica/ui-react/dropdown-menu` |
| `scroll-area` | `@appica/ui-react/scroll-area` |
| `tabs` | `@appica/ui-react/tabs` |
| `tooltip` | `@appica/ui-react/tooltip` |

Button 的 variant / size：

| 现有 | Appica |
|---|---|
| 缺省、`default` | `primary` |
| `destructive` | `destructive` |
| `outline` | `outline` |
| `secondary` | `secondary` |
| `ghost` | `ghost` |
| `link` | `ghost`，并在 `className` 保留下划线 |
| `size` 缺省、`default` | `md` |
| `sm` | `sm` |
| `lg` | `lg` |
| `icon` | `icon-md` |

按钮放进 `<form>` 且当前就是提交动作时，写 `type="submit"`。Appica Button 默认 `type="button"`。其余按钮保持 `type="button"`。

`asChild` 不要保留。打开对应组件的 `.md`，改成文档里的 `render`。`ChapterTree.tsx` 的菜单触发按钮必须继续 `onClick` 里 `stopPropagation`，否则一点菜单就会选中章节。`IconButton.tsx` 必须继续在 `onFocus` 里调用 `event.preventDefault()`，`tests/workbench-layout.test.ts` 会检查这行。

Dialog：

- `open` / `onOpenChange` 留在 `<Dialog>` 上。现有 `(open) => { if (!open) onClose() }` 可以继续用。
- 删掉 `size`。宽度加到 `DialogContent` 的 `className`：`sm` → `max-w-sm`，`md` → 不加，`lg` → `sm:max-w-2xl`，`xl` → `sm:max-w-4xl`，`full` → `w-[90vw] max-w-[90vw] h-[90vh]`。原有 `className` 合并进去。
- `hideClose` 改成 `closeButton={false}`。这三个文件里必须出现这串字符：`KnowledgeBaseDialog.tsx`、`CandidateReviewDialog.tsx`、`OutlineEditorDialog.tsx`。
- `DialogContent` 增加 `closeLabel="关闭"`（`closeButton={false}` 的除外）。
- 不要把 `motion` 的 props 传给 `DialogContent`。
- 只有 `ConfirmActionDialog.tsx` 改用 `@appica/ui-react/alert-dialog` 的同名分区（AlertDialog、AlertDialogContent、AlertDialogHeader、AlertDialogTitle、AlertDialogFooter）。它现在带 `role="alertdialog"`。

Badge 的 `success`、`warning`、`outline`：只使用 badge.md API 表里存在的 variant。表里没有的不要传，改用表里语义最接近的一项。

Card、ScrollArea、Tabs：根节点继续接收现在的 `className` 和 `children`。Tabs 的 value prop 以 tabs.md 为准，把现有选中值原样接上。

改完后删除整个 `src/renderer/components/ui/`。然后从 `package.json` 移除这些依赖并 `pnpm install`：

- `@radix-ui/react-dialog`
- `@radix-ui/react-dropdown-menu`
- `@radix-ui/react-popover`
- `@radix-ui/react-scroll-area`
- `@radix-ui/react-slot`
- `@radix-ui/react-tabs`
- `@radix-ui/react-tooltip`

`clsx` 和 `tailwind-merge`：全仓库没有引用后再删。

同步改测试：`tests/workbench-layout.test.ts` 里三处 `toContain('hideClose')` 改成 `toContain('closeButton={false}')`。

本步要改到的现有引用文件：

- `src/renderer/components/common/IconButton.tsx`
- `src/renderer/components/dialogs/` 下全部用到 `../ui/` 的对话框
- `src/renderer/features/shelf/ProjectShelf.tsx`
- `src/renderer/features/shelf/ImportPreviewModal.tsx`
- `src/renderer/features/workbench/TopBar.tsx`
- `src/renderer/features/workbench/ChapterTree.tsx`
- `src/renderer/features/drawer/` 下五个抽屉内容文件

## 3. Toast 保持原调用

`App.tsx` 继续使用 `ToastProvider` 和 `useToast()`。调用方不要改：`showToast(message, type)` 仍在 `ChatWorkbenchDialog.tsx`、`ConnectionDialog.tsx`、`LiteraryReportsDialog.tsx`、`OutlineEditorDialog.tsx`。

重写 `src/renderer/components/common/Toast.tsx`：

- 外层渲染 Appica 的 `ToastProvider` 和一次 `<Toaster position="bottom-right" />`，导入来自 `@appica/ui-react/toast`。
- 内层再用现有 React context，导出同名 `useToast()`。
- `showToast` 调 `useToastManager().add({ title: message, type, timeout: duration ?? 3500, priority: type === 'error' ? 'high' : 'low', data: { icon } })`。`icon` 用现有的 lucide 图标：`success` CheckCircle2，`error` AlertCircle，`warning` AlertTriangle，`info` Info。
- `dismissToast(id)` 调 `useToastManager().close(id)`。
- provider 外面调用 `useToast()` 时，保留现在的 console.warn fallback。
- 删掉这个文件里的 `motion` 列表。

`useToastManager` 只能在 Appica 的 `ToastProvider` 里面调用。context 桥要放在它的子节点里。

## 4. 把原生控件换成 Appica

只改下列文件里的 `<button>`、`<input>`、`<textarea>`、`<select>`。不要改 `WindowControls.tsx`。不要改 CodeMirror 组件内部。

每个原生控件在改之前打开对应文档：

- 按钮：`button.md`
- 单行输入：`input.md`
- 多行：`textarea.md`
- 下拉：`select.md`
- 勾选：`checkbox.md`
- 数字：`number-field.md`

`value`、`checked`、`onChange` 的选项值和回调保持原样，只换 prop 名到文档里的受控写法。可见的 label 文字用 `@appica/ui-react/field` 的 Field 套上。没有现成 label 文字就不要加 Field。

文件：

1. `src/renderer/features/editor/EditorHeader.tsx`：标题 `<input>` 改 Input。其余按钮改 Button，`variant="ghost"`，图标按钮 `size="icon-sm"` 并保留 `aria-label`。
2. `src/renderer/features/editor/EditorStatusBar.tsx`：保存按钮改 Button，`variant="ghost"`，保留 `aria-label="强制保存"` 和 `onForceSave`。
3. `src/renderer/features/editor/EmptyChapterState.tsx`：创建按钮改 Button。`className` 必须仍包含连续字符串 `primary-button create-first-chapter-btn`。只读分支的 class `empty-readonly-badge`、文案 `当前作品为只读模式`、`新建第一章`、`纸白墨润，静待下笔`、`当前作品暂无章节` 都保留。
4. `src/renderer/features/editor/EditorFloatingMenu.tsx`
5. `src/renderer/components/editor/EditorToolbar.tsx`：按钮改 Button。字号那一组改成一个 `@appica/ui-react/number-field` 的 NumberField，值接到现有的字号 preference 写入函数。不要改 CodeMirror 的 keymap。
6. `src/renderer/components/editor/FloatingSelectionMenu.tsx`：按钮改 Button。定位逻辑不要动。
7. `src/renderer/features/workbench/NavRail.tsx`
8. `src/renderer/features/workbench/ActionDock.tsx`：按钮改 Button。保留字符串 `w-max whitespace-nowrap`。
9. `src/renderer/features/workbench/TopBar.tsx` 里剩下的 `<button>`
10. `src/renderer/features/workbench/ChapterTree.tsx`：搜索框和重命名框改 Input。行内 `<button>` 改 Button。
11. `src/renderer/features/drawer/DrawerHost.tsx`：关闭按钮改 Button，`size="icon-sm"`，`variant="ghost"`，`aria-label` 保留。侧栏仍是 `<aside>`。
12. `src/renderer/features/drawer/KnowledgeDrawer.tsx`、`TaskCenterDrawer.tsx` 里剩下的 input / button。
13. `src/renderer/components/workbench/WorkflowGuideBanner.tsx`
14. 对话框里的原生 input、textarea、select、checkbox、button。重点文件：`ImportPreviewModal.tsx`、`AcceptancePreviewDialog.tsx`、`ConnectionDialog.tsx`、`ConnectionEditDialog.tsx`、`ContextPreviewDialog.tsx`、`ChatWorkbenchDialog.tsx`、`CandidateReviewDialog.tsx`，以及第 2 步清单里其余仍含这些标签的对话框。

`ConnectionEditDialog.tsx` 里的布尔勾选改 Checkbox，不要改成 Switch。

按钮上已有的「创建中...」「生成中」一类等待文案保留。旁边可以加 `@appica/ui-react/spinner` 的 Spinner。不要新造加载状态。

书架和导入预览里已有的红底错误条，改成 `@appica/ui-react/alert` 的 Alert，文案不改。

不要引入 Popover、Drawer、Slider、Kbd、Chip、Separator、Progress、Toggle、Toggle Group。现有界面没有对应的独立控件，字号已经用 NumberField。

## 5. Beautiful UI：只抽壳，不贴演示

这六个 registry 条目是带英文商品文案的演示，并引用 `@/components/atoms/Button`、`GlideMenu` 或 `glimm`。不要把 JSON 里的文件原样拷进仓库，不要 `pnpm add glimm`，不要保留 `"use client"`。

下载到临时目录即可，用来抄布局 class：

- `https://www.beautifului.dev/r/streaming-text.json`
- `https://www.beautifului.dev/r/thinking-state.json`
- `https://www.beautifului.dev/r/prompt-bar.json`
- `https://www.beautifului.dev/r/approval-card.json`
- `https://www.beautifului.dev/r/task-rows.json`
- `https://www.beautifului.dev/r/selection-actions.json`

在 `src/renderer/components/ai/` 写六个文件。按钮用 Appica Button。演示数组（QUESTIONS、TOKENS、FOLLOW_UPS、品牌图标）不要留下。

| 文件 | 导出 | 接到 |
|---|---|---|
| `StreamingText.tsx` | `StreamingText({ text }: { text: string })`。按空白分词，用 streaming-text 演示里单词出现的 class。无引用芯片、无追问 | `ChatWorkbenchDialog.tsx` 和 `CandidateReviewDialog.tsx` 里渲染 `streaming.value` 的那个文本节点。不要改 `useStreamThrottle` |
| `ThinkingState.tsx` | `ThinkingState({ label }: { label: string })`。只显示这一句 | `ChatWorkbenchDialog.tsx` 中 `isStreaming` 为真时渲染，`label="正在生成"` |
| `PromptBar.tsx` | `PromptBar({ value, onChange, onSubmit, disabled })`。不要 shader。外层用 prompt-bar 演示里输入区的 class，内部仍是受控 textarea 和发送按钮 | 替换 `ChatWorkbenchDialog.tsx` 底部 composer 的 textarea 和发送按钮。`className` 保留 `chat-input-box` 和 `chat-input-textarea`。提交逻辑仍走原来的发送函数 |
| `ApprovalCard.tsx` | `ApprovalCard({ title, description, confirmLabel, cancelLabel, onConfirm, onCancel, disabled })`。只一组标题、说明、两个按钮。不要单选问卷，不要 GlideMenu | `CandidateReviewDialog.tsx` 底部「写回正文」和「关闭」换成这个组件。文件里必须仍能搜到字符串 `写回正文` 和 `差异审阅` |
| `TaskRows.tsx` | `TaskRows({ items }: { items: { id: string; title: string; state: string }[] })` | `TaskCenterDrawer.tsx` 的任务列表。`title` 和 `state` 用该文件已有字段。数据获取不要改 |
| `SelectionActions.tsx` | `SelectionActions({ children })`。只提供演示里的外框 class | 包住 `FloatingSelectionMenu.tsx` 现有按钮。按钮动作一个都不要删 |

`text` 为空时 `StreamingText` 返回 `null`。

## 6. transitions.dev：只贴四个免费动效

不要装 CLI，不要贴 Pro 卡片，不要改 Appica Dialog 和 Toast 的动画。

新建 `src/renderer/styles/transitions.css`，在 `index.css` 里 `@import "./transitions.css"`。从 `https://transitions.dev/` 复制这四张免费卡片的 CSS，标题必须对得上：

- Text states swap
- Skeleton loader and reveal
- Texts reveal
- Number pop-in

卡片上如果是 `data-pro="true"`，跳过该张，不要用别的动画顶替。

接法：

- Text states swap：`EditorHeader.tsx` 的章节标题元素。
- Skeleton loader and reveal：`TaskCenterDrawer.tsx` 里任务列表为空时已经存在的占位节点。没有占位节点就加到现有空状态容器的 `className`，不要新写一套空状态文案。
- Texts reveal：`ProjectShelf.tsx` 的作品卡片列表容器。
- Number pop-in：`EditorStatusBar.tsx` 里 `.word-count` 中显示 `totalWords` 的 `<strong>`。

## 7. 改 ADR

替换 `docs/adr/0005-renderer-component-and-workspace-interaction-hierarchy.md` 的 Decision 为：

基础组件是 `@appica/ui-react`，主题 token 在 `src/renderer/styles/index.css`。对话框用 Appica Dialog，确认框用 Alert Dialog，Toast 用 Appica Toast，调用仍走 `useToast()`。右侧参考面板继续是工作台里的并排 aside，不用模态 Drawer。AI 表面只用 `src/renderer/components/ai/` 的 StreamingText、ThinkingState、PromptBar、ApprovalCard、TaskRows、SelectionActions。动效只使用 `transitions.css` 里的四段。HeroUI、Rare UI、beUI、shadcn 源码不引入。

Context 和 Consequences 里与「自有 shadcn 源码」矛盾的句子改成上一句的结果，不要留两套决策。

## 8. 检查

在仓库根目录：

```bash
pnpm typecheck
pnpm test
```

另外确认：

- `src` 里没有 `components/ui/` 的 import。
- `src` 里没有 `@radix-ui/` 的 import。
- `src/renderer` 的 `<button>` 只出现在 `WindowControls.tsx`。
- `src/renderer` 的 `<input>`、`<textarea>`、`<select>` 不再出现。PromptBar 内部如果文档组件必须用原生 textarea 才能受控，只允许出现在 `components/ai/PromptBar.tsx` 这一个文件。
- `WindowControls.tsx`、`useDialogDismiss.ts`、`Inspector.tsx` 的 diff 为空。
- `tests/empty-chapter-state.test.ts` 不需要改，并且通过。

不要跑 `pnpm test:e2e`，不要打包。

## 完成时的数量

这些数字是结果，不是再去凑的配额。对不上就检查有没有漏文件，不要为了数字加组件。

- Appica：Button、Badge、Card、Dialog、Alert Dialog、Dropdown Menu、Scroll Area、Tabs、Tooltip、Toast、Input、Textarea、Select、Field、Checkbox、Number Field、Spinner、Alert。共 18 个。目录 70，约 26%。
- 产品界面里的按钮、输入、下拉、多行文本，除窗口三键和 PromptBar 内部 textarea 外，都走上述组件。
- Beautiful UI：上面 6 个文件，目录 26，约 23%。
- transitions.dev：4 段，首页公开卡片 43，约 9%。
- HeroUI、Rare UI、beUI、shadcn：0。
