import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toolsApi } from '../api/client'
import type { CncTool, ToolType } from '../types'

const TOOL_TYPES: ToolType[] = ['FlatEndMill', 'BallEndMill', 'BullNoseEndMill', 'DrillBit', 'Engraver', 'Facemill', 'Custom']

export default function ToolLibrary() {
  const qc = useQueryClient()
  const { data: tools = [] } = useQuery({ queryKey: ['tools'], queryFn: toolsApi.getAll })
  const [editing, setEditing] = useState<Partial<CncTool> | null>(null)

  const createMutation = useMutation({
    mutationFn: toolsApi.create,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['tools'] }); setEditing(null) },
  })

  const deleteMutation = useMutation({
    mutationFn: toolsApi.delete,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tools'] }),
  })

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-semibold text-white">CNC Tool Library</h2>
        <button onClick={() => setEditing({ type: 'FlatEndMill', fluteCount: 2, toolMaterial: 'HSS', recommendedRpm: 10000, recommendedFeedMmPerMin: 500 })}
          className="px-4 py-2 bg-primary/80 hover:bg-primary text-white text-sm rounded-lg">
          + Add Tool
        </button>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-gray-500 border-b border-gray-800">
              {['Name', 'Type', 'Ø (mm)', 'Flute L (mm)', 'Flutes', 'RPM', 'Feed mm/min', ''].map(h => (
                <th key={h} className="text-left py-2 px-3 font-medium">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {tools.map(t => (
              <tr key={t.id} className="border-b border-gray-800/50 text-gray-300 hover:bg-gray-900">
                <td className="py-2.5 px-3 font-medium text-white">{t.name}</td>
                <td className="px-3">{t.type}</td>
                <td className="px-3">{t.diameterMm}</td>
                <td className="px-3">{t.fluteLengthMm}</td>
                <td className="px-3">{t.fluteCount}</td>
                <td className="px-3">{t.recommendedRpm.toLocaleString()}</td>
                <td className="px-3">{t.recommendedFeedMmPerMin}</td>
                <td className="px-3">
                  <button onClick={() => deleteMutation.mutate(t.id)} className="text-red-500 hover:text-red-400 text-xs">Remove</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {editing && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
          <div className="bg-gray-900 border border-gray-700 rounded-xl p-6 w-full max-w-lg space-y-4">
            <h3 className="font-semibold text-white">New CNC Tool</h3>

            <input className="input w-full" placeholder="Tool name" value={editing.name ?? ''}
              onChange={e => setEditing({ ...editing, name: e.target.value })} />

            <select className="input w-full" value={editing.type} onChange={e => setEditing({ ...editing, type: e.target.value as ToolType })}>
              {TOOL_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
            </select>

            <div className="grid grid-cols-2 gap-3">
              {([
                ['diameterMm', 'Diameter (mm)'],
                ['fluteLengthMm', 'Flute Length (mm)'],
                ['shankDiameterMm', 'Shank Ø (mm)'],
                ['fluteCount', 'Flutes'],
                ['recommendedRpm', 'RPM'],
                ['recommendedFeedMmPerMin', 'Feed (mm/min)'],
                ['maxDepthOfCutMm', 'Max DoC (mm)'],
              ] as [keyof CncTool, string][]).map(([k, label]) => (
                <div key={k} className="space-y-1">
                  <label className="text-xs text-gray-400">{label}</label>
                  <input type="number" className="input w-full"
                    value={(editing as Record<string, number>)[k as string] ?? ''}
                    onChange={e => setEditing({ ...editing, [k]: +e.target.value })} />
                </div>
              ))}
            </div>

            <div className="flex gap-3 justify-end">
              <button onClick={() => setEditing(null)} className="px-4 py-2 bg-gray-800 text-gray-300 rounded-lg text-sm">Cancel</button>
              <button onClick={() => createMutation.mutate(editing)} className="px-4 py-2 bg-primary/80 hover:bg-primary text-white rounded-lg text-sm">Save</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
