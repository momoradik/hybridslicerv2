import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { printProfilesApi } from '../api/client'
import type { PrintProfile } from '../types'

export default function PrintSettings() {
  const qc = useQueryClient()
  const { data: profiles = [] } = useQuery({ queryKey: ['printProfiles'], queryFn: printProfilesApi.getAll })
  const [selected, setSelected] = useState<Partial<PrintProfile> | null>(null)

  const createMutation = useMutation({
    mutationFn: printProfilesApi.create,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['printProfiles'] }); setSelected(null) },
  })

  const defaults: Partial<PrintProfile> = {
    name: '',
    layerHeightMm: 0.2,
    lineWidthMm: 0.4,
    wallCount: 3,
    printSpeedMmS: 50,
    travelSpeedMmS: 150,
    infillDensityPct: 20,
    infillPattern: 'grid',
    printTemperatureDegC: 210,
    bedTemperatureDegC: 60,
    retractLengthMm: 5,
    supportEnabled: false,
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-semibold text-white">Print Settings</h2>
        <button onClick={() => setSelected(defaults)} className="px-4 py-2 bg-primary/80 hover:bg-primary text-white text-sm rounded-lg">
          + New Profile
        </button>
      </div>

      <div className="grid grid-cols-3 gap-4">
        {profiles.map(p => (
          <button
            key={p.id}
            onClick={() => setSelected(p)}
            className="text-left bg-gray-900 border border-gray-800 hover:border-gray-600 rounded-xl p-4 transition"
          >
            <p className="font-medium text-white">{p.name}</p>
            <p className="text-xs text-gray-500 mt-1">
              LH: {p.layerHeightMm} mm · {p.infillDensityPct}% infill · {p.printTemperatureDegC}°C
            </p>
          </button>
        ))}
      </div>

      {selected && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
          <div className="bg-gray-900 border border-gray-700 rounded-xl p-6 w-full max-w-2xl space-y-4 overflow-y-auto max-h-[90vh]">
            <h3 className="font-semibold text-white">{selected.id ? 'Edit' : 'New'} Print Profile</h3>

            <NumberField label="Layer Height (mm)" value={selected.layerHeightMm ?? 0.2}
              step={0.05} min={0.05} max={0.8}
              onChange={v => setSelected({ ...selected, layerHeightMm: v })} />

            <NumberField label="Print Speed (mm/s)" value={selected.printSpeedMmS ?? 50}
              onChange={v => setSelected({ ...selected, printSpeedMmS: v })} />

            <NumberField label="Infill Density (%)" value={selected.infillDensityPct ?? 20}
              min={0} max={100}
              onChange={v => setSelected({ ...selected, infillDensityPct: v })} />

            <NumberField label="Print Temp (°C)" value={selected.printTemperatureDegC ?? 210}
              min={150} max={350}
              onChange={v => setSelected({ ...selected, printTemperatureDegC: v })} />

            <NumberField label="Bed Temp (°C)" value={selected.bedTemperatureDegC ?? 60}
              min={0} max={120}
              onChange={v => setSelected({ ...selected, bedTemperatureDegC: v })} />

            <label className="flex items-center gap-2 text-sm text-gray-300">
              <input type="checkbox" checked={selected.supportEnabled ?? false}
                onChange={e => setSelected({ ...selected, supportEnabled: e.target.checked })}
                className="accent-primary" />
              Enable Support
            </label>

            <div className="flex gap-3 justify-end pt-2">
              <button onClick={() => setSelected(null)} className="px-4 py-2 bg-gray-800 text-gray-300 rounded-lg text-sm">Cancel</button>
              <button onClick={() => createMutation.mutate(selected)} className="px-4 py-2 bg-primary/80 hover:bg-primary text-white rounded-lg text-sm">
                Save
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function NumberField({ label, value, onChange, step = 1, min, max }:
  { label: string; value: number; onChange: (v: number) => void; step?: number; min?: number; max?: number }) {
  return (
    <div className="space-y-1">
      <label className="text-sm text-gray-400">{label}</label>
      <input
        type="number" step={step} min={min} max={max}
        value={value}
        onChange={e => onChange(+e.target.value)}
        className="input w-full"
      />
    </div>
  )
}
