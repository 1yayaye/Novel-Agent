import { create } from 'zustand'

export type DrawerType = 'beats' | 'outline' | 'knowledge' | 'inspector' | 'tasks'

export type DialogType =
  | 'backup'
  | 'export'
  | 'connection'
  | 'creative'
  | 'search'
  | 'candidate'
  | 'tour'
  | 'chat'
  | 'context'
  | 'analysis'
  | 'synopsis'
  | 'reports'
  | 'issues'
  | 'suggestion'
  | 'confirm'
  | 'outline'
  | 'knowledge'

export interface WorkbenchState {
  isNavExpanded: boolean
  isZenMode: boolean
  activeDrawer: DrawerType | null
  activeDialog: DialogType | null
  dialogPayload: unknown

  setNavExpanded: (expanded: boolean) => void
  toggleNavExpanded: () => void
  setZenMode: (zen: boolean) => void
  toggleZenMode: () => void
  openDrawer: (drawer: DrawerType) => void
  closeDrawer: () => void
  toggleDrawer: (drawer: DrawerType) => void
  openDialog: (dialog: DialogType, payload?: unknown) => void
  closeDialog: () => void
}

export const useWorkbenchStore = create<WorkbenchState>((set) => ({
  isNavExpanded: false,
  isZenMode: false,
  activeDrawer: null,
  activeDialog: null,
  dialogPayload: null,

  setNavExpanded: (isNavExpanded) => set({ isNavExpanded }),
  toggleNavExpanded: () => set((state) => ({ isNavExpanded: !state.isNavExpanded })),

  setZenMode: (isZenMode) => set({ isZenMode }),
  toggleZenMode: () => set((state) => ({ isZenMode: !state.isZenMode })),

  openDrawer: (drawer) => set({ activeDrawer: drawer }),
  closeDrawer: () => set({ activeDrawer: null }),
  toggleDrawer: (drawer) =>
    set((state) => ({
      activeDrawer: state.activeDrawer === drawer ? null : drawer
    })),

  openDialog: (dialog, payload = null) => set({ activeDialog: dialog, dialogPayload: payload }),
  closeDialog: () => set({ activeDialog: null, dialogPayload: null })
}))
