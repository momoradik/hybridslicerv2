import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { machineProfilesApi } from '../api/client'
import DisabledHint from '../components/DisabledHint'
import MachineLayoutPreview from '../components/MachineLayoutPreview'
import type { MachineProfile, ExtruderAssignment, OriginMode } from '../types'
import { EXTRUDER_DUTIES } from '../types'

// Highlight keys used to link input fields to diagram elements.
// null = nothing highlighted.
type HighlightKey =
  | null
  | 'travel' | 'origin' | 'bed'
  | 'leftEdge' | 'rightEdge' | 'frontEdge' | 'backEdge'
  | `nozzleY-${number}` | `nozzleX-${number}`
  | `nozzle-${number}`   // a specific extruder marker

interface MachineForm {
  name: string
  type: 'Hybrid' | 'FDM' | 'CNC'
  travelXMm: number
  travelYMm: number
  travelZMm: number
  originMode: OriginMode
  bedWidthMm: number
  bedDepthMm: number
  bedHeightMm: number
  bedPositionXMm: number
  bedPositionYMm: number
  originXMm: number
  originYMm: number
  extruderCount: number
  nozzleXOffsets: number[]
  nozzleYOffsets: number[]
  leftBedEdgeOffsetMm: number
  rightBedEdgeOffsetMm: number
  frontBedEdgeOffsetMm: number
  backBedEdgeOffsetMm: number
  extruderAssignments: ExtruderAssignment[]
  ipAddress: string
  port: number
  cncOffsetX: number
  cncOffsetY: number
  cncOffsetZ: number
  cncOffsetRot: number
}

function parseJsonArray(json: string | undefined): number[] {
  try { return JSON.parse(json || '[]') }
  catch { return [] }
}

function machineToForm(m: MachineProfile): MachineForm {
  return {
    name: m.name,
    type: m.type as MachineForm['type'],
    travelXMm: m.travelXMm || m.bedWidthMm,
    travelYMm: m.travelYMm || m.bedDepthMm,
    travelZMm: m.travelZMm || m.bedHeightMm,
    originMode: m.originMode ?? 'BedCenter',
    bedWidthMm: m.bedWidthMm,
    bedDepthMm: m.bedDepthMm,
    bedHeightMm: m.bedHeightMm,
    bedPositionXMm: m.bedPositionXMm ?? 0,
    bedPositionYMm: m.bedPositionYMm ?? 0,
    originXMm: m.originXMm ?? 0,
    originYMm: m.originYMm ?? 0,
    extruderCount: m.extruderCount,
    nozzleXOffsets: parseJsonArray(m.nozzleXOffsetsJson),
    nozzleYOffsets: parseJsonArray(m.nozzleYOffsetsJson),
    leftBedEdgeOffsetMm: m.leftBedEdgeOffsetMm ?? 0,
    rightBedEdgeOffsetMm: m.rightBedEdgeOffsetMm ?? 0,
    frontBedEdgeOffsetMm: m.frontBedEdgeOffsetMm ?? 0,
    backBedEdgeOffsetMm: m.backBedEdgeOffsetMm ?? 0,
    extruderAssignments: m.extruderAssignments ?? [],
    ipAddress: m.ipAddress ?? '',
    port: m.port || 8080,
    cncOffsetX: m.cncOffset?.x ?? 0,
    cncOffsetY: m.cncOffset?.y ?? 0,
    cncOffsetZ: m.cncOffset?.z ?? 0,
    cncOffsetRot: m.cncOffset?.rotationDeg ?? 0,
  }
}

function emptyForm(): MachineForm {
  return {
    name: '',
    type: 'Hybrid',
    travelXMm: 440,
    travelYMm: 290,
    travelZMm: 350,
    originMode: 'BedCenter',
    bedWidthMm: 440,
    bedDepthMm: 290,
    bedHeightMm: 350,
    bedPositionXMm: 0,
    bedPositionYMm: 0,
    originXMm: 0,
    originYMm: 0,
    extruderCount: 1,
    nozzleXOffsets: [],
    nozzleYOffsets: [],
    leftBedEdgeOffsetMm: 0,
    rightBedEdgeOffsetMm: 0,
    frontBedEdgeOffsetMm: 0,
    backBedEdgeOffsetMm: 0,
    extruderAssignments: [{ extruderIndex: 0, duty: 'All' }],
    ipAddress: '',
    port: 8080,
    cncOffsetX: 0,
    cncOffsetY: 0,
    cncOffsetZ: 0,
    cncOffsetRot: 0,
  }
}

export default function MachineConfig() {
  const qc = useQueryClient()
  const { data: machines = [] } = useQuery({ queryKey: ['machines'], queryFn: machineProfilesApi.getAll })
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState<MachineForm | null>(null)
  const [highlight, setHighlight] = useState<HighlightKey>(null)

  const createMutation = useMutation({
    mutationFn: machineProfilesApi.create,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['machines'] }); setForm(null) },
  })

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: object }) => machineProfilesApi.update(id, data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['machines'] }); setForm(null) },
  })

  const deleteMutation = useMutation({
    mutationFn: machineProfilesApi.delete,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['machines'] }) },
  })

  const openNew = () => { setEditingId(null); setForm(emptyForm()); setHighlight(null) }
  const openEdit = (m: MachineProfile) => { setEditingId(m.id); setForm(machineToForm(m)); setHighlight(null) }

  const set = <K extends keyof MachineForm>(k: K, v: MachineForm[K]) =>
    setForm(f => f ? { ...f, [k]: v } : f)

  const setExtruderCount = (count: number) => {
    if (!form) return
    const c = Math.max(1, Math.min(8, count))
    const yOffsets = form.nozzleYOffsets.slice(0, c - 1)
    while (yOffsets.length < c - 1) yOffsets.push(30)
    const xOffsets = form.nozzleXOffsets.slice(0, c - 1)
    while (xOffsets.length < c - 1) xOffsets.push(0)
    const assignments = form.extruderAssignments.filter(a => a.extruderIndex < c)
    for (let i = 0; i < c; i++) {
      if (!assignments.find(a => a.extruderIndex === i))
        assignments.push({ extruderIndex: i, duty: 'All' })
    }
    assignments.sort((a, b) => a.extruderIndex - b.extruderIndex)
    setForm(f => f ? { ...f, extruderCount: c, nozzleXOffsets: xOffsets, nozzleYOffsets: yOffsets, extruderAssignments: assignments } : f)
  }

  const setNozzleXOffset = (idx: number, val: number) => {
    if (!form) return
    const offsets = [...form.nozzleXOffsets]; offsets[idx] = val
    set('nozzleXOffsets', offsets)
  }

  const setNozzleYOffset = (idx: number, val: number) => {
    if (!form) return
    const offsets = [...form.nozzleYOffsets]; offsets[idx] = val
    set('nozzleYOffsets', offsets)
  }

  const setAssignment = (extIdx: number, duty: string) => {
    if (!form) return
    const assignments = form.extruderAssignments
      .filter(a => a.extruderIndex !== extIdx)
      .concat([{ extruderIndex: extIdx, duty }])
      .sort((a, b) => a.extruderIndex - b.extruderIndex)
    set('extruderAssignments', assignments)
  }

  const handleSave = () => {
    if (!form || !form.name.trim()) return
    const payload = {
      name: form.name, type: form.type,
      travelXMm: form.travelXMm, travelYMm: form.travelYMm, travelZMm: form.travelZMm,
      originMode: form.originMode,
      bedWidthMm: form.bedWidthMm, bedDepthMm: form.bedDepthMm, bedHeightMm: form.bedHeightMm,
      bedPositionXMm: form.bedPositionXMm, bedPositionYMm: form.bedPositionYMm,
      originXMm: form.originXMm, originYMm: form.originYMm,
      extruderCount: form.extruderCount,
      nozzleXOffsets: form.nozzleXOffsets, nozzleYOffsets: form.nozzleYOffsets,
      leftBedEdgeOffsetMm: form.leftBedEdgeOffsetMm, rightBedEdgeOffsetMm: form.rightBedEdgeOffsetMm,
      frontBedEdgeOffsetMm: form.frontBedEdgeOffsetMm, backBedEdgeOffsetMm: form.backBedEdgeOffsetMm,
      extruderAssignments: form.extruderAssignments.map(a => ({ extruderIndex: a.extruderIndex, duty: a.duty })),
      ipAddress: form.ipAddress || undefined, port: form.port,
      cncOffset: { x: form.cncOffsetX, y: form.cncOffsetY, z: form.cncOffsetZ, rotationDeg: form.cncOffsetRot },
    }
    if (editingId) updateMutation.mutate({ id: editingId, data: payload })
    else createMutation.mutate(payload)
  }

  // ── Offset validation ──────────────────────────────────────────────────
  const offsetIssues = form ? validateOffsets(form) : []
  const offsetErrors   = offsetIssues.filter(i => i.level === 'error')
  const offsetWarnings = offsetIssues.filter(i => i.level === 'warn')

  // Helper: wrap a field so focus/hover sets the highlight key
  const hField = (key: HighlightKey) => ({
    onFocus: () => setHighlight(key),
    onBlur:  () => setHighlight(h => h === key ? null : h),
    onMouseEnter: () => setHighlight(key),
    onMouseLeave: () => setHighlight(h => h === key ? null : h),
  })

  const isSaving = createMutation.isPending || updateMutation.isPending

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-semibold text-white">Machine Configuration</h2>
        <button onClick={openNew}
          className="px-4 py-2 bg-primary/80 hover:bg-primary text-white text-sm rounded-lg">
          + New Machine
        </button>
      </div>

      {/* Machine list */}
      <div className="grid gap-4">
        {machines.map(m => (
          <div key={m.id} className="bg-gray-900 border border-gray-800 rounded-xl p-5 flex items-center justify-between">
            <div>
              <p className="font-medium text-white">{m.name}</p>
              <p className="text-xs text-gray-500 mt-0.5">
                {m.type} · {m.bedWidthMm}×{m.bedDepthMm}×{m.bedHeightMm} mm · {m.extruderCount} extruder{m.extruderCount > 1 ? 's' : ''}
                {m.ipAddress && ` · ${m.ipAddress}:${m.port}`}
              </p>
              <p className="text-xs text-gray-600 mt-0.5">
                CNC Offset: X{m.cncOffset?.x ?? 0} Y{m.cncOffset?.y ?? 0} Z{m.cncOffset?.z ?? 0}
              </p>
              {(m.extruderAssignments?.length ?? 0) > 0 && (
                <p className="text-xs text-gray-600 mt-0.5">
                  Duties: {m.extruderAssignments.map(a => `E${a.extruderIndex + 1}=${a.duty}`).join(', ')}
                </p>
              )}
            </div>
            <div className="flex gap-2">
              <button onClick={() => openEdit(m)}
                className="text-sm text-gray-400 hover:text-white px-3 py-1 rounded bg-gray-800">Edit</button>
              <button onClick={() => { if (confirm('Delete this machine?')) deleteMutation.mutate(m.id) }}
                className="text-sm text-gray-400 hover:text-red-400 px-3 py-1 rounded bg-gray-800">Delete</button>
            </div>
          </div>
        ))}
        {machines.length === 0 && (
          <p className="text-gray-500 text-sm text-center py-8">No machine configurations. Click "+ New Machine" to add one.</p>
        )}
      </div>

      {/* Modal */}
      {form && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
          <div className="bg-gray-900 border border-gray-700 rounded-xl p-6 w-full max-w-3xl space-y-4 max-h-[90vh] overflow-y-auto">
            <h3 className="font-semibold text-white text-lg">{editingId ? 'Edit Machine' : 'New Machine'}</h3>

            {/* Name */}
            <MField label="Machine Name">
              <input className="input w-full" value={form.name}
                onChange={e => set('name', e.target.value)} placeholder="My Hybrid Machine" />
            </MField>

            {/* ── STEP 1: Machine Frame ── */}
            <div className="border-t border-gray-800 pt-3 space-y-3">
              <h4 className="text-sm font-semibold text-white">1. Machine Frame</h4>
              <p className="text-xs text-gray-500">Total physical travel of the machine on each axis.</p>
              <div {...hField('travel')} className="grid grid-cols-3 gap-3">
                <MField label="X Travel (mm)">
                  <NumInput value={form.travelXMm} min={1} max={5000} onChange={v => set('travelXMm', v)} />
                </MField>
                <MField label="Y Travel (mm)">
                  <NumInput value={form.travelYMm} min={1} max={5000} onChange={v => set('travelYMm', v)} />
                </MField>
                <MField label="Z Travel (mm)">
                  <NumInput value={form.travelZMm} min={1} max={5000} onChange={v => set('travelZMm', v)} />
                </MField>
              </div>
            </div>

            {/* ── STEP 2: Bed ── */}
            <div className="border-t border-gray-800 pt-3 space-y-3">
              <h4 className="text-sm font-semibold text-white">2. Bed / Build Area</h4>
              <p className="text-xs text-gray-500">Size of the printable bed, and where it sits inside the machine frame.</p>
              <div {...hField('bed')} className="grid grid-cols-3 gap-3">
                <MField label="Bed Width X (mm)">
                  <NumInput value={form.bedWidthMm} min={1} max={2000} onChange={v => set('bedWidthMm', v)} />
                </MField>
                <MField label="Bed Depth Y (mm)">
                  <NumInput value={form.bedDepthMm} min={1} max={2000} onChange={v => set('bedDepthMm', v)} />
                </MField>
                <MField label="Print Height Z (mm)">
                  <NumInput value={form.bedHeightMm} min={1} max={2000} onChange={v => set('bedHeightMm', v)} />
                </MField>
              </div>
              <p className="text-xs text-gray-500">Bed position inside machine (front-left corner of bed in machine coordinates).</p>
              <div {...hField('bed')} className="grid grid-cols-2 gap-3">
                <MField label="Bed Position X (mm)">
                  <NumInput value={form.bedPositionXMm} min={0} max={5000} step={0.1}
                    onChange={v => set('bedPositionXMm', v)} />
                </MField>
                <MField label="Bed Position Y (mm)">
                  <NumInput value={form.bedPositionYMm} min={0} max={5000} step={0.1}
                    onChange={v => set('bedPositionYMm', v)} />
                </MField>
              </div>
              <p className="text-xs text-gray-500 mt-2">Machine origin (0,0) position in the travel frame.</p>
              <div {...hField('origin')} className="grid grid-cols-2 gap-3">
                <MField label="Origin X (mm)">
                  <NumInput value={form.originXMm} min={0} max={5000} step={0.1}
                    onChange={v => set('originXMm', v)} />
                </MField>
                <MField label="Origin Y (mm)">
                  <NumInput value={form.originYMm} min={0} max={5000} step={0.1}
                    onChange={v => set('originYMm', v)} />
                </MField>
              </div>
              <p className="text-xs text-gray-600">Print reference is at bed center. The slicer uses bed-centre as (0,0) for G-code.</p>
            </div>

            {/* ── STEP 3: Extruders ── */}
            <div className="border-t border-gray-800 pt-3 space-y-3">
              <h4 className="text-sm font-semibold text-white">3. Extruders</h4>
              <MField label="Number of Extruders">
                <NumInput value={form.extruderCount} min={1} max={8} onChange={setExtruderCount} />
              </MField>

              {/* ── Unified machine layout preview ── */}
              <MachineLayoutPreview
                travelX={form.travelXMm}
                travelY={form.travelYMm}
                originMode={form.originMode}
                bedWidth={form.bedWidthMm}
                bedDepth={form.bedDepthMm}
                bedPositionX={form.bedPositionXMm}
                bedPositionY={form.bedPositionYMm}
                extruderCount={form.extruderCount}
                nozzleXOffsets={form.nozzleXOffsets}
                nozzleYOffsets={form.nozzleYOffsets}
                leftEdge={form.leftBedEdgeOffsetMm}
                rightEdge={form.rightBedEdgeOffsetMm}
                frontEdge={form.frontBedEdgeOffsetMm}
                backEdge={form.backBedEdgeOffsetMm}
                extruderAssignments={form.extruderAssignments}
                highlight={highlight}
                originX={form.originXMm}
                originY={form.originYMm}
                isHybrid={form.type === 'Hybrid'}
                cncOffsetX={form.cncOffsetX}
                cncOffsetY={form.cncOffsetY}
                onBedPositionChange={(x, y) => setForm(f => f ? { ...f, bedPositionXMm: x, bedPositionYMm: y } : f)}
                onBedSizeChange={(w, d) => setForm(f => f ? { ...f, bedWidthMm: w, bedDepthMm: d } : f)}
                onNozzleOffsetChange={(idx, dx, dy) => setForm(f => {
                  if (!f) return f
                  const xo = [...f.nozzleXOffsets]; xo[idx] = dx
                  const yo = [...f.nozzleYOffsets]; yo[idx] = dy
                  return { ...f, nozzleXOffsets: xo, nozzleYOffsets: yo }
                })}
                onExtruder1PositionChange={(front, left) => setForm(f =>
                  f ? { ...f, frontBedEdgeOffsetMm: front, leftBedEdgeOffsetMm: left } : f)}
                onOriginChange={(x, y) => setForm(f => f ? { ...f, originXMm: x, originYMm: y } : f)}
              />

              {/* Nozzle Spacing (only when > 1 extruder) */}
              {form.extruderCount > 1 && (
                <div className="space-y-2">
                  <p className="text-sm text-gray-400">Nozzle Spacing (mm)</p>
                  <p className="text-xs text-gray-600">Distance between adjacent nozzles. X = front-back, Y = left-right.</p>
                  <div className="grid grid-cols-2 gap-2">
                    {form.nozzleXOffsets.map((v, i) => (
                      <div key={i} {...hField(`nozzleX-${i}`)}>
                        <MField label={`E${i + 1} → E${i + 2} (X)`}>
                          <NumInput value={v} min={-500} max={500} step={0.1} onChange={val => setNozzleXOffset(i, val)} />
                        </MField>
                      </div>
                    ))}
                  </div>
                  <p className="text-sm text-gray-400 mt-2">Y Spacing (left-right)</p>
                  <div className="grid grid-cols-2 gap-2">
                    {form.nozzleYOffsets.map((v, i) => {
                      const issue = v <= 0
                      return (
                        <div key={i} {...hField(`nozzleY-${i}`)}>
                          <MField label={`E${i + 1} → E${i + 2} (Y)`}>
                            <NumInput value={v} min={0} max={500} step={0.1} onChange={val => setNozzleYOffset(i, val)} />
                          </MField>
                          {issue && <p className="text-[10px] text-red-400 mt-0.5">Y spacing is required between adjacent nozzles.</p>}
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}

              {/* Nozzle-to-Bed-Edge */}
              <div className="space-y-2">
                <p className="text-sm text-gray-400">Nozzle to Bed Edge (mm)</p>
                <p className="text-xs text-gray-600">How far the nozzle stops from the bed edge. 0 = nozzle can reach the edge.</p>
                <p className="text-xs text-gray-500 mt-1">Left / Right (Y direction)</p>
                <div className="grid grid-cols-2 gap-3">
                  <div {...hField('leftEdge')}>
                    <MField label="Left Edge (Y)">
                      <NumInput value={form.leftBedEdgeOffsetMm} min={0} max={500} step={0.1}
                        onChange={v => set('leftBedEdgeOffsetMm', v)} />
                    </MField>
                  </div>
                  <div {...hField('rightEdge')}>
                    <MField label="Right Edge (Y)">
                      <NumInput value={form.rightBedEdgeOffsetMm} min={0} max={500} step={0.1}
                        onChange={v => set('rightBedEdgeOffsetMm', v)} />
                    </MField>
                  </div>
                </div>
                <p className="text-xs text-gray-500 mt-1">Front / Back (X direction)</p>
                <div className="grid grid-cols-2 gap-3">
                  <div {...hField('frontEdge')}>
                    <MField label="Front Edge (X)">
                      <NumInput value={form.frontBedEdgeOffsetMm} min={0} max={500} step={0.1}
                        onChange={v => set('frontBedEdgeOffsetMm', v)} />
                    </MField>
                  </div>
                  <div {...hField('backEdge')}>
                    <MField label="Back Edge (X)">
                      <NumInput value={form.backBedEdgeOffsetMm} min={0} max={500} step={0.1}
                        onChange={v => set('backBedEdgeOffsetMm', v)} />
                    </MField>
                  </div>
                </div>
              </div>

              {/* Extruder Duty Assignments */}
              <div className="space-y-2">
                <p className="text-sm text-gray-400">Extruder Duty Assignments</p>
                <div className="grid grid-cols-2 gap-2">
                  {Array.from({ length: form.extruderCount }, (_, i) => {
                    const assignment = form.extruderAssignments.find(a => a.extruderIndex === i)
                    return (
                      <div key={i} {...hField(`nozzle-${i}`)}>
                        <MField label={`Extruder ${i + 1}`}>
                          <select className="input w-full" value={assignment?.duty ?? 'All'}
                            onChange={e => setAssignment(i, e.target.value)}>
                            {EXTRUDER_DUTIES.map(d => (
                              <option key={d} value={d}>{d}</option>
                            ))}
                          </select>
                        </MField>
                      </div>
                    )
                  })}
                </div>
              </div>
            </div>

            {/* ── STEP 4: Network ── */}
            <div className="border-t border-gray-800 pt-3 space-y-3">
              <h4 className="text-sm font-semibold text-white">4. Network (optional)</h4>
              <div className="grid grid-cols-2 gap-3">
                <MField label="IP Address">
                  <input className="input w-full" value={form.ipAddress}
                    onChange={e => set('ipAddress', e.target.value)} placeholder="192.168.1.100" />
                </MField>
                <MField label="Port">
                  <NumInput value={form.port} min={1} max={65535} onChange={v => set('port', v)} />
                </MField>
              </div>
            </div>

            {/* ── STEP 5: CNC / Hybrid ── */}
            <div className="border-t border-gray-800 pt-3 space-y-3">
              <label className="flex items-center gap-3 cursor-pointer select-none">
                <input type="checkbox" className="w-4 h-4 accent-primary"
                  checked={form.type === 'Hybrid'}
                  onChange={e => set('type', e.target.checked ? 'Hybrid' : 'FDM')} />
                <div>
                  <span className="text-sm font-semibold text-white">Hybrid Machine (FDM + CNC)</span>
                  <p className="text-xs text-gray-500">Enable CNC spindle mapping for hybrid manufacturing</p>
                </div>
              </label>

              {form.type === 'Hybrid' && (
                <div className="space-y-3 ml-7">
                  <p className="text-xs text-gray-500">CNC spindle position relative to Extruder 1 (E1).</p>
                  <div className="grid grid-cols-3 gap-3">
                    <MField label="CNC X from E1 (mm)">
                      <NumInput value={form.cncOffsetX} step={0.1} onChange={v => set('cncOffsetX', v)} />
                    </MField>
                    <MField label="CNC Y from E1 (mm)">
                      <NumInput value={form.cncOffsetY} step={0.1} onChange={v => set('cncOffsetY', v)} />
                    </MField>
                    <MField label="CNC Z from E1 (mm)">
                      <NumInput value={form.cncOffsetZ} step={0.1} onChange={v => set('cncOffsetZ', v)} />
                    </MField>
                  </div>
                </div>
              )}
            </div>

            {/* Validation summary */}
            {offsetIssues.length > 0 && (
              <div className="space-y-1.5">
                {offsetErrors.map((issue, i) => (
                  <div key={`e${i}`} className="bg-red-950/40 border border-red-800 rounded-lg px-3 py-1.5 text-xs text-red-400 flex items-start gap-2">
                    <span className="shrink-0 mt-px">!!!</span>
                    <span>{issue.message}</span>
                  </div>
                ))}
                {offsetWarnings.map((issue, i) => (
                  <div key={`w${i}`} className="bg-yellow-950/40 border border-yellow-800 rounded-lg px-3 py-1.5 text-xs text-yellow-400 flex items-start gap-2">
                    <span className="shrink-0 mt-px">!</span>
                    <span>{issue.message}</span>
                  </div>
                ))}
              </div>
            )}

            {/* Actions */}
            <div className="flex gap-3 justify-end pt-2 border-t border-gray-800">
              <button onClick={() => setForm(null)}
                className="px-4 py-2 bg-gray-800 text-gray-300 rounded-lg text-sm">Cancel</button>
              <DisabledHint when={!form.name.trim() || offsetErrors.length > 0} reason={
                !form.name.trim() ? 'Enter a machine name to save.'
                : `Fix ${offsetErrors.length} error${offsetErrors.length !== 1 ? 's' : ''} before saving.`
              }>
                <button onClick={handleSave}
                  disabled={!form.name.trim() || offsetErrors.length > 0 || isSaving}
                  className="px-4 py-2 bg-primary/80 hover:bg-primary disabled:opacity-40 text-white rounded-lg text-sm">
                  {isSaving ? 'Saving…' : 'Save'}
                </button>
              </DisabledHint>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Machine mapping validation ────────────────────────────────────────────────

interface OffsetIssue { level: 'error' | 'warn'; message: string }

function validateOffsets(f: MachineForm): OffsetIssue[] {
  const issues: OffsetIssue[] = []

  // ── Machine travel vs bed size ─────────────────────────────────────────
  if (f.bedWidthMm > f.travelXMm)
    issues.push({ level: 'error', message: `Bed width (${f.bedWidthMm} mm) exceeds machine X travel (${f.travelXMm} mm). The bed cannot be larger than the machine.` })
  if (f.bedDepthMm > f.travelYMm)
    issues.push({ level: 'error', message: `Bed depth (${f.bedDepthMm} mm) exceeds machine Y travel (${f.travelYMm} mm). The bed cannot be larger than the machine.` })
  if (f.bedHeightMm > f.travelZMm)
    issues.push({ level: 'error', message: `Bed height (${f.bedHeightMm} mm) exceeds machine Z travel (${f.travelZMm} mm).` })

  // ── Multi-extruder: nozzle spacing required ────────────────────────────
  if (f.extruderCount > 1) {
    const allYZero = f.nozzleYOffsets.every(v => v <= 0)
    const allXZero = f.nozzleXOffsets.every(v => v === 0)
    if (allYZero && allXZero)
      issues.push({ level: 'error', message: `${f.extruderCount} extruders but no spacing defined. Set X or Y nozzle offsets so nozzles don't overlap.` })
    else if (allYZero)
      issues.push({ level: 'error', message: `${f.extruderCount} extruders but all Y offsets are 0. Nozzles need spacing on at least one axis.` })
    // Individual Y offsets = 0 warning
    for (let i = 0; i < f.extruderCount - 1; i++) {
      if ((f.nozzleYOffsets[i] ?? 0) <= 0 && (f.nozzleXOffsets[i] ?? 0) === 0)
        issues.push({ level: 'error', message: `E${i + 1} → E${i + 2}: both X and Y offsets are 0. Nozzles would overlap.` })
    }
  }

  // ── Compute cumulative nozzle positions ────────────────────────────────
  const posX: number[] = [0], posY: number[] = [0]
  for (let i = 0; i < f.extruderCount - 1; i++) {
    posX.push(posX[posX.length - 1] + (f.nozzleXOffsets[i] ?? 0))
    posY.push(posY[posY.length - 1] + (f.nozzleYOffsets[i] ?? 0))
  }

  // ── Nozzles + bed edges vs bed size ────────────────────────────────────
  const ySpan = Math.max(...posY) - Math.min(...posY)
  const totalY = f.leftBedEdgeOffsetMm + ySpan + f.rightBedEdgeOffsetMm
  if (totalY > f.bedDepthMm && f.bedDepthMm > 0)
    issues.push({ level: 'warn', message: `Nozzle layout + bed edges (${totalY.toFixed(1)} mm Y) exceeds bed depth (${f.bedDepthMm} mm). Outermost nozzle cannot reach bed edge.` })

  const xSpan = Math.max(...posX) - Math.min(...posX)
  const totalX = f.frontBedEdgeOffsetMm + xSpan + f.backBedEdgeOffsetMm
  if (totalX > f.bedWidthMm && f.bedWidthMm > 0)
    issues.push({ level: 'warn', message: `Nozzle layout + bed edges (${totalX.toFixed(1)} mm X) exceeds bed width (${f.bedWidthMm} mm). Outermost nozzle cannot reach bed edge.` })

  // ── Nozzles vs machine travel ──────────────────────────────────────────
  if (totalY > f.travelYMm && f.travelYMm > 0)
    issues.push({ level: 'error', message: `Nozzle Y layout (${totalY.toFixed(1)} mm) exceeds machine Y travel (${f.travelYMm} mm). Nozzles cannot physically fit.` })
  if (totalX > f.travelXMm && f.travelXMm > 0)
    issues.push({ level: 'error', message: `Nozzle X layout (${totalX.toFixed(1)} mm) exceeds machine X travel (${f.travelXMm} mm). Nozzles cannot physically fit.` })

  // ── Bed edge offsets: soft guidance ────────────────────────────────────
  if (f.leftBedEdgeOffsetMm === 0 && f.rightBedEdgeOffsetMm === 0
    && f.frontBedEdgeOffsetMm === 0 && f.backBedEdgeOffsetMm === 0)
    issues.push({ level: 'warn', message: 'All bed-edge offsets are 0. Set these if the nozzle cannot reach the very edge of the bed.' })

  // ── Extruder duty mapping completeness ─────────────────────────────────
  if (f.extruderCount > 1) {
    const hasWalls   = f.extruderAssignments.some(a => a.duty === 'Walls' || a.duty === 'All')
    const hasInfill  = f.extruderAssignments.some(a => a.duty === 'Infill' || a.duty === 'All')
    const hasSupport = f.extruderAssignments.some(a => a.duty === 'Support' || a.duty === 'All')
    if (!hasWalls)
      issues.push({ level: 'warn', message: 'No extruder assigned to Walls. Walls will default to E0.' })
    if (!hasInfill)
      issues.push({ level: 'warn', message: 'No extruder assigned to Infill. Infill will default to E0.' })
    if (!hasSupport)
      issues.push({ level: 'warn', message: 'No extruder assigned to Support. Support will default to E0.' })
    // Check for duplicate duties on same extruder (not an error, just info)
    const allOnSame = new Set(f.extruderAssignments.map(a => a.extruderIndex)).size === 1
    if (allOnSame && f.extruderAssignments.length > 1)
      issues.push({ level: 'warn', message: 'All duties assigned to the same extruder. No tool changes will occur.' })
  }

  return issues
}

// ── Small helpers ──────────────────────────────────────────────────────────────

function MField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <label className="text-sm text-gray-400">{label}</label>
      {children}
    </div>
  )
}

function NumInput({
  value, min, max, step = 1, onChange,
}: {
  value: number; min?: number; max?: number; step?: number
  onChange: (v: number) => void
}) {
  return (
    <input
      type="number"
      className="input text-sm w-full"
      value={value}
      min={min}
      max={max}
      step={step}
      onChange={e => { const v = parseFloat(e.target.value); if (!isNaN(v)) onChange(v) }}
    />
  )
}
