import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { machineProfilesApi } from '../api/client'
import type { MachineProfile } from '../types'

export default function MachineConfig() {
  const qc = useQueryClient()
  const { data: machines = [] } = useQuery({ queryKey: ['machines'], queryFn: machineProfilesApi.getAll })
  const [editing, setEditing] = useState<Partial<MachineProfile> | null>(null)

  const createMutation = useMutation({
    mutationFn: machineProfilesApi.create,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['machines'] }); setEditing(null) },
  })

  const updateOffsetsMutation = useMutation({
    mutationFn: ({ id, offsets }: { id: string; offsets: object }) =>
      machineProfilesApi.updateOffsets(id, offsets),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['machines'] }); setEditing(null) },
  })

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-semibold text-white">Machine Configuration</h2>
        <button onClick={() => setEditing({ type: 'Hybrid', nozzleDiameterMm: 0.4, extruderCount: 1, port: 8080, bedWidthMm: 200, bedDepthMm: 200, bedHeightMm: 200, cncOffset: { x: 0, y: 0, z: 0, rotationDeg: 0 } })}
          className="px-4 py-2 bg-primary/80 hover:bg-primary text-white text-sm rounded-lg">
          + New Machine
        </button>
      </div>

      <div className="grid gap-4">
        {machines.map(m => (
          <div key={m.id} className="bg-gray-900 border border-gray-800 rounded-xl p-5 flex items-center justify-between">
            <div>
              <p className="font-medium text-white">{m.name}</p>
              <p className="text-xs text-gray-500 mt-0.5">
                {m.type} · {m.bedWidthMm}×{m.bedDepthMm}×{m.bedHeightMm} mm
                {m.ipAddress && ` · ${m.ipAddress}:${m.port}`}
              </p>
              <p className="text-xs text-gray-600 mt-0.5">
                CNC Offset: X{m.cncOffset?.x ?? 0} Y{m.cncOffset?.y ?? 0} Z{m.cncOffset?.z ?? 0}
              </p>
            </div>
            <button onClick={() => setEditing(m)} className="text-sm text-gray-400 hover:text-white px-3 py-1 rounded bg-gray-800">
              Edit Offsets
            </button>
          </div>
        ))}
      </div>

      {editing && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
          <div className="bg-gray-900 border border-gray-700 rounded-xl p-6 w-full max-w-lg space-y-4">
            <h3 className="font-semibold text-white">{editing.id ? 'Edit Machine' : 'New Machine'}</h3>

            {!editing.id && (
              <>
                <input className="input w-full" placeholder="Machine name" value={editing.name ?? ''}
                  onChange={e => setEditing({ ...editing, name: e.target.value })} />
                <div className="grid grid-cols-3 gap-3">
                  {(['bedWidthMm', 'bedDepthMm', 'bedHeightMm'] as const).map(k => (
                    <div key={k} className="space-y-1">
                      <label className="text-xs text-gray-400">{k}</label>
                      <input type="number" className="input w-full" value={(editing as Record<string, number>)[k] ?? 200}
                        onChange={e => setEditing({ ...editing, [k]: +e.target.value })} />
                    </div>
                  ))}
                </div>
              </>
            )}

            <div className="space-y-1">
              <p className="text-sm text-gray-400 font-medium">CNC Offsets (mm)</p>
              <div className="grid grid-cols-3 gap-3">
                {(['x', 'y', 'z'] as const).map(axis => (
                  <div key={axis} className="space-y-1">
                    <label className="text-xs text-gray-400">{axis.toUpperCase()}</label>
                    <input type="number" step={0.01} className="input w-full"
                      value={editing.cncOffset?.[axis] ?? 0}
                      onChange={e => setEditing({
                        ...editing,
                        cncOffset: { x: 0, y: 0, z: 0, rotationDeg: 0, ...editing.cncOffset, [axis]: +e.target.value }
                      })} />
                  </div>
                ))}
              </div>
            </div>

            <div className="flex gap-3 justify-end">
              <button onClick={() => setEditing(null)} className="px-4 py-2 bg-gray-800 text-gray-300 rounded-lg text-sm">Cancel</button>
              <button
                onClick={() => {
                  if (editing.id) {
                    updateOffsetsMutation.mutate({
                      id: editing.id,
                      offsets: { x: editing.cncOffset?.x ?? 0, y: editing.cncOffset?.y ?? 0, z: editing.cncOffset?.z ?? 0, rotationDeg: editing.cncOffset?.rotationDeg ?? 0, toolOffsets: [] }
                    })
                  } else {
                    createMutation.mutate(editing)
                  }
                }}
                className="px-4 py-2 bg-primary/80 hover:bg-primary text-white rounded-lg text-sm"
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
