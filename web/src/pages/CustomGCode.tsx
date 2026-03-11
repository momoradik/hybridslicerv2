import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { customGCodeApi } from '../api/client'
import type { CustomGCodeBlock, GCodeTrigger } from '../types'

const TRIGGERS: GCodeTrigger[] = [
  'JobStart', 'BeforeMachining', 'AfterMachining', 'BeforePrinting', 'AfterPrinting', 'JobEnd'
]

export default function CustomGCode() {
  const qc = useQueryClient()
  const { data: blocks = [] } = useQuery({ queryKey: ['gcode-blocks'], queryFn: customGCodeApi.getAll })

  const [editing, setEditing] = useState<Partial<CustomGCodeBlock> | null>(null)

  const createMutation = useMutation({
    mutationFn: customGCodeApi.create,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['gcode-blocks'] }); setEditing(null) },
  })

  const updateMutation = useMutation({
    mutationFn: ({ id, ...data }: Partial<CustomGCodeBlock> & { id: string }) =>
      customGCodeApi.update(id, data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['gcode-blocks'] }); setEditing(null) },
  })

  const toggleMutation = useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) => customGCodeApi.toggle(id, enabled),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['gcode-blocks'] }),
  })

  const deleteMutation = useMutation({
    mutationFn: customGCodeApi.delete,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['gcode-blocks'] }),
  })

  const handleSave = () => {
    if (!editing) return
    if (editing.id) updateMutation.mutate(editing as Partial<CustomGCodeBlock> & { id: string })
    else createMutation.mutate(editing)
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-semibold text-white">Custom G-code Blocks</h2>
        <button
          onClick={() => setEditing({ trigger: 'BeforeMachining', isEnabled: true, sortOrder: 0 })}
          className="px-4 py-2 bg-primary/80 hover:bg-primary text-white text-sm rounded-lg"
        >
          + New Block
        </button>
      </div>

      <div className="grid gap-3">
        {blocks.map(block => (
          <div key={block.id} className="bg-gray-900 border border-gray-800 rounded-xl p-4 flex items-start gap-4">
            <label className="flex items-center mt-0.5 cursor-pointer">
              <input
                type="checkbox"
                checked={block.isEnabled}
                onChange={e => toggleMutation.mutate({ id: block.id, enabled: e.target.checked })}
                className="w-4 h-4 accent-primary"
              />
            </label>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <p className="font-medium text-white">{block.name}</p>
                <span className="px-2 py-0.5 bg-gray-800 text-gray-400 text-xs rounded-full">{block.trigger}</span>
              </div>
              <pre className="mt-2 text-xs text-gray-500 font-mono bg-gray-950 rounded p-2 overflow-x-auto max-h-20">
                {block.gCodeContent}
              </pre>
            </div>
            <div className="flex gap-2 shrink-0">
              <button onClick={() => setEditing(block)} className="text-gray-400 hover:text-white text-xs">Edit</button>
              <button onClick={() => deleteMutation.mutate(block.id)} className="text-red-500 hover:text-red-400 text-xs">Del</button>
            </div>
          </div>
        ))}
      </div>

      {/* Editor modal */}
      {editing && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
          <div className="bg-gray-900 border border-gray-700 rounded-xl p-6 w-full max-w-xl space-y-4">
            <h3 className="font-semibold text-white">{editing.id ? 'Edit' : 'New'} G-code Block</h3>

            <input
              className="input w-full"
              placeholder="Block name"
              value={editing.name ?? ''}
              onChange={e => setEditing({ ...editing, name: e.target.value })}
            />

            <select
              className="input w-full"
              value={editing.trigger}
              onChange={e => setEditing({ ...editing, trigger: e.target.value as GCodeTrigger })}
            >
              {TRIGGERS.map(t => <option key={t} value={t}>{t}</option>)}
            </select>

            <textarea
              className="input w-full font-mono text-xs h-40 resize-none"
              placeholder="; Enter G-code here"
              value={editing.gCodeContent ?? ''}
              onChange={e => setEditing({ ...editing, gCodeContent: e.target.value })}
            />

            <div className="flex gap-3 justify-end">
              <button onClick={() => setEditing(null)} className="px-4 py-2 bg-gray-800 text-gray-300 rounded-lg text-sm">Cancel</button>
              <button onClick={handleSave} className="px-4 py-2 bg-primary/80 hover:bg-primary text-white rounded-lg text-sm">Save</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
