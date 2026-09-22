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
  updateOrAddTask: (task: Partial<TaskItem> & { id: string }) => void
  setTasks: (tasks: TaskItem[]) => void
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

  updateOrAddTask: (task) => {
    set((state) => {
      const exists = state.tasks.find((t) => t.id === task.id)
      if (exists) {
        return {
          tasks: state.tasks.map((t) => (t.id === task.id ? { ...t, ...task } : t)),
          activeTaskId: task.status === 'running' ? task.id : state.activeTaskId
        }
      }
      return {
        tasks: [
          {
            id: task.id,
            type: task.type || 'task',
            title: task.title || '后台任务',
            progress: task.progress ?? 0,
            status: task.status ?? 'running',
            stage: task.stage,
            message: task.message,
            createdAt: task.createdAt ?? Date.now()
          },
          ...state.tasks
        ],
        activeTaskId: task.id
      }
    })
  },

  setTasks: (tasks) => set({ tasks }),

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
