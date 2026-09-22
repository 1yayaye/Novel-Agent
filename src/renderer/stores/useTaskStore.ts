import { create } from 'zustand'

export interface TaskItem {
  id: string
  type: string
  title: string
  progress: number
  status: 'running' | 'completed' | 'failed' | 'cancelled'
  stage?: string
  message?: string
  createdAt: number
}

export interface TaskState {
  tasks: TaskItem[]
  activeTaskId: string | null

  addTask: (task: Omit<TaskItem, 'createdAt'>) => void
  updateTask: (id: string, updates: Partial<TaskItem>) => void
  removeTask: (id: string) => void
  setActiveTask: (id: string | null) => void
  clearCompleted: () => void
}

export const useTaskStore = create<TaskState>((set) => ({
  tasks: [],
  activeTaskId: null,

  addTask: (task) => {
    set((state) => ({
      tasks: [
        {
          ...task,
          createdAt: Date.now()
        },
        ...state.tasks.filter((t) => t.id !== task.id)
      ],
      activeTaskId: task.id
    }))
  },

  updateTask: (id, updates) => {
    set((state) => ({
      tasks: state.tasks.map((t) => (t.id === id ? { ...t, ...updates } : t))
    }))
  },

  removeTask: (id) => {
    set((state) => ({
      tasks: state.tasks.filter((t) => t.id !== id),
      activeTaskId: state.activeTaskId === id ? null : state.activeTaskId
    }))
  },

  setActiveTask: (id) => set({ activeTaskId: id }),

  clearCompleted: () => {
    set((state) => ({
      tasks: state.tasks.filter((t) => t.status === 'running')
    }))
  }
}))
