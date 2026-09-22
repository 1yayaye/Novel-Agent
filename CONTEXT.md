# Novel Agent Frontend

The renderer presentation layer for Novel Agent, providing a local-first desktop novel writing workbench.

## Language

**Workbench**:
The primary split-pane desktop workspace comprising navigation rail, chapter list, central editor, and inspector.
_Avoid_: Dashboard, studio, main window

**Chapter Editor**:
The central CodeMirror 6 novel prose editing canvas with typesetting, distraction-free zen mode, and selection actions.
_Avoid_: Text area, editor box, writing pad

**Inspector**:
The collapsible right sidebar providing chapter metadata, live word count, character mentions, and consistency diagnostics.
_Avoid_: Side panel, properties panel, info bar

**Shelf**:
The opening book-management view where novel projects are listed, opened, or imported from raw text.
_Avoid_: Home page, project selector, project list

**Candidate Diff**:
The side-by-side or inline review interface comparing AI-generated revisions against original novel text before user acceptance.
_Avoid_: Merge window, change comparison, git diff

**Task Center**:
The non-blocking drawer/dialog monitoring background LLM analysis, creation pipelines, and batch operations.
_Avoid_: Progress modal, queue manager, worker dialog

**Drawer**:
A slide-over panel docking to the right side of the workbench for non-blocking secondary references (Outline, Knowledge Base, Task Center).
_Avoid_: Sidebar popup, flyout modal, secondary window

**Floating Action Popover**:
A contextual floating card anchored to the text selection or cursor for inline AI polish and quick actions.
_Avoid_: Context menu, inline modal, hover balloon

**Story Beats**:
Structural narrative pacing cards (起承转合 / scene conflict tension) displayed in the reference drawer to track chapter momentum.
_Avoid_: Plot points, scene list, outline nodes

**Action Dock**:
A floating bottom capsule dock providing quick one-click triggers for frequent creative operations (outline lookup, character cards, one-click polish, story beats, live word count).
_Avoid_: Bottom toolbar, status bar, action bar


