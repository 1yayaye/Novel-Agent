import { useState } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@appica/ui-react/dialog'
import { Button } from '@appica/ui-react/button'
import { Input } from '@appica/ui-react/input'
import { Field, FieldLabel } from '@appica/ui-react/field'

export function CreateSnapshotDialog({
  error,
  onCancel,
  onConfirm
}: {
  error: string
  onCancel: () => void
  onConfirm: (name: string) => void
}) {
  const [name, setName] = useState('')

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault()
    if (name.trim()) {
      onConfirm(name.trim())
    }
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onCancel() }}>
      <DialogContent frame={false} className="max-w-sm" closeLabel="关闭">
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <DialogHeader className="pb-1">
            <DialogTitle>创建章节快照</DialogTitle>
          </DialogHeader>
          <Field className="flex flex-col gap-1.5 text-xs text-[#7d6b59] px-6">
            <FieldLabel>快照名称</FieldLabel>
            <Input
              autoFocus
              className="rounded-lg border border-[#dacdbe] bg-white px-3 py-2 text-sm text-[#2c2523] outline-none focus:border-[#2d6a4f] focus:ring-2 focus:ring-[#2d6a4f]/20"
              placeholder="例如：大纲调整前、修改第2版"
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </Field>
          {error && <p className="inline-error text-xs text-red-600 px-6">{error}</p>}
          <DialogFooter className="pt-2">
            <Button type="button" variant="ghost" onClick={onCancel}>
              取消
            </Button>
            <Button type="submit" disabled={!name.trim()}>
              创建快照
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
