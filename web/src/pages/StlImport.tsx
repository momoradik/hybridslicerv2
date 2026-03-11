import { useState, useCallback, useEffect, useRef } from 'react'
import { useQuery, useMutation } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import StlViewer, {
  type BuildVolume,
  type ModelTransform,
  type ModelEntry,
  type StlViewerHandle,
  DEFAULT_TRANSFORM,
} from '../components/viewer/StlViewer'
import { jobsApi, machineProfilesApi, printProfilesApi, materialsApi } from '../api/client'

// ── Per-model state ───────────────────────────────────────────────────────────

interface ModelState extends ModelEntry {
  file: File
  size: { x: number; y: number; z: number } | null
  isOutOfBounds: boolean
}

let idCounter = 0
const mkId = () => `model-${++idCounter}`

// ── Component ─────────────────────────────────────────────────────────────────

export default function StlImport() {
  const navigate   = useNavigate()
  const viewerRef  = useRef<StlViewerHandle>(null)

  const [models, setModels]       = useState<ModelState[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [isDragOver, setIsDragOver] = useState(false)
  const [hasFaceSelected, setHasFaceSelected] = useState(false)
  const [uniformScale, setUniformScale]       = useState(true)

  const [jobName, setJobName]       = useState('')
  const [machineId, setMachineId]   = useState('')
  const [profileId, setProfileId]   = useState('')
  const [materialId, setMaterialId] = useState('')

  const [buildVolume, setBuildVolume] = useState<BuildVolume>({ width: 220, depth: 220, height: 250 })

  const { data: machines = [] } = useQuery({ queryKey: ['machines'], queryFn: machineProfilesApi.getAll })
  const { data: profiles = [] } = useQuery({ queryKey: ['printProfiles'], queryFn: printProfilesApi.getAll })
  const { data: materials = [] } = useQuery({ queryKey: ['materials'], queryFn: materialsApi.getAll })

  const uploadMutation = useMutation({
    mutationFn: (fd: FormData) => jobsApi.uploadStl(fd),
    onSuccess: () => navigate('/dashboard'),
  })

  // Sync build volume from machine profile
  useEffect(() => {
    if (!machineId) return
    const m = machines.find(m => m.id === machineId)
    if (m) setBuildVolume({ width: m.bedWidthMm, depth: m.bedDepthMm, height: m.bedHeightMm })
  }, [machineId, machines])

  // Clear face-selected badge when selection changes
  useEffect(() => { setHasFaceSelected(false) }, [selectedId])

  // ── Model helpers ──────────────────────────────────────────────────────────

  const selectedModel = models.find(m => m.id === selectedId) ?? null

  const addFile = useCallback((f: File) => {
    if (!f.name.toLowerCase().endsWith('.stl')) return
    const id  = mkId()
    const url = URL.createObjectURL(f)
    const entry: ModelState = {
      id, file: f, url,
      name: f.name.replace(/\.stl$/i, ''),
      transform: { ...DEFAULT_TRANSFORM },
      size: null,
      isOutOfBounds: false,
    }
    setModels(prev => [...prev, entry])
    setSelectedId(id)
    if (models.length === 0) setJobName(entry.name)
  }, [models.length])

  const removeModel = (id: string) => {
    setModels(prev => {
      const next = prev.filter(m => m.id !== id)
      URL.revokeObjectURL(prev.find(m => m.id === id)?.url ?? '')
      return next
    })
    if (selectedId === id) setSelectedId(models.find(m => m.id !== id)?.id ?? null)
  }

  const updateTransform = useCallback((id: string, t: ModelTransform) => {
    setModels(prev => prev.map(m => m.id === id ? { ...m, transform: t } : m))
  }, [])

  const patchSelected = (patch: Partial<ModelTransform>) => {
    if (!selectedModel) return
    const next = { ...selectedModel.transform, ...patch }
    updateTransform(selectedModel.id, next)
  }

  const patchScale = (axis: 'scaleX' | 'scaleY' | 'scaleZ', val: number) => {
    if (!selectedModel) return
    if (uniformScale) {
      updateTransform(selectedModel.id, {
        ...selectedModel.transform,
        scaleX: val, scaleY: val, scaleZ: val,
      })
    } else {
      patchSelected({ [axis]: val })
    }
  }

  // ── Viewer callbacks ───────────────────────────────────────────────────────

  const handleModelLoaded = useCallback((id: string, size: { x: number; y: number; z: number }) => {
    setModels(prev => prev.map(m => m.id === id ? { ...m, size } : m))
  }, [])

  const handleBoundsChange = useCallback((id: string, out: boolean) => {
    setModels(prev => prev.map(m => m.id === id ? { ...m, isOutOfBounds: out } : m))
  }, [])

  // ── Drop / input ───────────────────────────────────────────────────────────

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragOver(false)
    Array.from(e.dataTransfer.files).forEach(f => addFile(f))
  }, [addFile])

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    Array.from(e.target.files ?? []).forEach(f => addFile(f))
    e.target.value = ''
  }

  // ── Submit ─────────────────────────────────────────────────────────────────

  const handleSubmit = () => {
    const primary = selectedModel ?? models[0]
    if (!primary || !machineId || !profileId || !materialId || !jobName) return
    const t = primary.transform
    const fd = new FormData()
    fd.append('file', primary.file)
    fd.append('jobName', jobName)
    fd.append('machineProfileId', machineId)
    fd.append('printProfileId', profileId)
    fd.append('materialId', materialId)
    fd.append('positionX', t.x.toString())
    fd.append('positionY', t.y.toString())
    fd.append('positionZ', t.z.toString())
    uploadMutation.mutate(fd)
  }

  const canSubmit = models.length > 0 && !!machineId && !!profileId && !!materialId && !!jobName && !uploadMutation.isPending
  const anyOOB    = models.some(m => m.isOutOfBounds)

  // ── Effective model size (natural × scale) ─────────────────────────────────
  const effectiveSize = selectedModel?.size
    ? {
        x: selectedModel.size.x * selectedModel.transform.scaleX,
        y: selectedModel.size.y * selectedModel.transform.scaleY,
        z: selectedModel.size.z * selectedModel.transform.scaleZ,
      }
    : null

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="grid grid-cols-2 gap-6 h-[calc(100vh-8rem)]">

      {/* ── Left: 3D Viewer ─────────────────────────────────────────────── */}
      <div
        className={`bg-gray-900 rounded-xl overflow-hidden relative border-2 transition-colors
          ${isDragOver ? 'border-primary border-dashed' : 'border-gray-700 border-dashed'}`}
        onDrop={handleDrop}
        onDragOver={e => { e.preventDefault(); setIsDragOver(true) }}
        onDragLeave={() => setIsDragOver(false)}
      >
        {models.length > 0 ? (
          <>
            <StlViewer
              ref={viewerRef}
              models={models}
              selectedId={selectedId}
              className="w-full h-full"
              buildVolume={buildVolume}
              onModelLoaded={handleModelLoaded}
              onBoundsChange={handleBoundsChange}
              onTransformChange={updateTransform}
              onModelSelect={setSelectedId}
              onFaceSelected={setHasFaceSelected}
            />

            {/* Overlay badges */}
            <div className="absolute top-3 left-3 flex flex-col gap-2 pointer-events-none select-none">
              {anyOOB && (
                <div className="bg-red-900/85 text-red-200 text-xs px-3 py-1.5 rounded-lg backdrop-blur-sm">
                  Model outside build volume
                </div>
              )}
              {hasFaceSelected && (
                <div className="bg-orange-900/85 text-orange-200 text-xs px-3 py-1.5 rounded-lg backdrop-blur-sm">
                  Face selected — click &ldquo;Place Face on Bed&rdquo;
                </div>
              )}
              {effectiveSize && (
                <div className="bg-gray-900/80 text-gray-300 text-xs px-3 py-1.5 rounded-lg backdrop-blur-sm">
                  {effectiveSize.x.toFixed(1)} × {effectiveSize.y.toFixed(1)} × {effectiveSize.z.toFixed(1)} mm
                </div>
              )}
            </div>

            {/* Hints */}
            <div className="absolute bottom-3 left-3 pointer-events-none select-none">
              <p className="text-gray-600 text-xs">
                L-click model to select · Drag to move · Click face to select · R-drag/scroll to orbit
              </p>
            </div>

            {/* Add model button */}
            <label className="absolute bottom-3 right-3 cursor-pointer text-xs px-3 py-1.5 rounded-lg
                              bg-gray-800/80 hover:bg-gray-700/90 text-gray-400 hover:text-gray-200
                              transition backdrop-blur-sm">
              + Add Model
              <input type="file" accept=".stl" multiple className="hidden" onChange={handleFileInput} />
            </label>
          </>
        ) : (
          <div className="absolute inset-0 flex flex-col items-center justify-center text-gray-500 gap-3 select-none">
            <svg className="w-14 h-14 opacity-40" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1}
                d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10" />
            </svg>
            <p className="text-sm font-medium">Drag &amp; drop STL here</p>
            <label className="cursor-pointer text-xs px-4 py-2 rounded-lg bg-gray-800 hover:bg-gray-700 transition text-gray-300">
              or Browse files
              <input type="file" accept=".stl" multiple className="hidden" onChange={handleFileInput} />
            </label>
          </div>
        )}
      </div>

      {/* ── Right: Config Panel ──────────────────────────────────────────── */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 overflow-y-auto flex flex-col gap-5">

        {/* Job Setup */}
        <section className="space-y-3">
          <SectionHeader>Job Setup</SectionHeader>
          <Field label="Job Name">
            <input className="input" value={jobName} onChange={e => setJobName(e.target.value)} placeholder="My part…" />
          </Field>
          <Field label="Machine Profile">
            <select className="input" value={machineId} onChange={e => setMachineId(e.target.value)}>
              <option value="">Select…</option>
              {machines.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
          </Field>
          <Field label="Print Profile">
            <select className="input" value={profileId} onChange={e => setProfileId(e.target.value)}>
              <option value="">Select…</option>
              {profiles.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </Field>
          <Field label="Material">
            <select className="input" value={materialId} onChange={e => setMaterialId(e.target.value)}>
              <option value="">Select…</option>
              {materials.map(m => <option key={m.id} value={m.id}>{m.name} ({m.type})</option>)}
            </select>
          </Field>
        </section>

        <Divider />

        {/* Build Volume */}
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <SectionHeader>Build Volume</SectionHeader>
            {machineId && <span className="text-xs text-gray-500">from machine profile</span>}
          </div>
          <div className="grid grid-cols-3 gap-2">
            <Field label="Width X (mm)">
              <NumInput value={buildVolume.width} min={1} max={2000}
                onChange={v => setBuildVolume(bv => ({ ...bv, width: v }))} />
            </Field>
            <Field label="Depth Y (mm)">
              <NumInput value={buildVolume.depth} min={1} max={2000}
                onChange={v => setBuildVolume(bv => ({ ...bv, depth: v }))} />
            </Field>
            <Field label="Height Z (mm)">
              <NumInput value={buildVolume.height} min={1} max={2000}
                onChange={v => setBuildVolume(bv => ({ ...bv, height: v }))} />
            </Field>
          </div>
        </section>

        {models.length > 0 && (
          <>
            <Divider />

            {/* Model List */}
            <section className="space-y-2">
              <div className="flex items-center justify-between">
                <SectionHeader>Models ({models.length})</SectionHeader>
                {models.length > 1 && (
                  <button
                    onClick={() => viewerRef.current?.autoArrange()}
                    className="text-xs px-3 py-1 rounded-lg bg-indigo-700/60 hover:bg-indigo-700 text-indigo-200 border border-indigo-600 transition"
                  >
                    Auto-Arrange
                  </button>
                )}
              </div>

              <div className="space-y-1 max-h-36 overflow-y-auto pr-1">
                {models.map(m => (
                  <div
                    key={m.id}
                    onClick={() => setSelectedId(m.id)}
                    className={`flex items-center gap-2 px-3 py-2 rounded-lg cursor-pointer transition-colors text-xs
                      ${m.id === selectedId
                        ? 'bg-indigo-900/60 border border-indigo-600 text-white'
                        : 'bg-gray-800/60 border border-gray-700 text-gray-300 hover:bg-gray-800'}`}
                  >
                    {/* Out-of-bounds dot */}
                    <span className={`w-2 h-2 rounded-full flex-shrink-0 ${m.isOutOfBounds ? 'bg-red-500' : 'bg-green-500'}`} />
                    <span className="truncate flex-1">{m.name}</span>
                    {m.size && (
                      <span className="text-gray-500 flex-shrink-0">
                        {(m.size.x * m.transform.scaleX).toFixed(0)}×{(m.size.y * m.transform.scaleY).toFixed(0)}×{(m.size.z * m.transform.scaleZ).toFixed(0)}
                      </span>
                    )}
                    <button
                      onClick={e => { e.stopPropagation(); removeModel(m.id) }}
                      className="text-gray-600 hover:text-red-400 transition ml-1 flex-shrink-0"
                      title="Remove"
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            </section>

            {/* Selected model transform controls */}
            {selectedModel && (
              <>
                <Divider />
                <section className="space-y-4">
                  <SectionHeader>Transform — {selectedModel.name}</SectionHeader>

                  {/* Position */}
                  <div className="space-y-1.5">
                    <label className="text-xs text-gray-400 font-medium">Position (mm)</label>
                    <div className="grid grid-cols-3 gap-2">
                      <Field label="X">
                        <NumInput value={+selectedModel.transform.x.toFixed(2)} step={0.5}
                          onChange={v => patchSelected({ x: v })} />
                      </Field>
                      <Field label="Y">
                        <NumInput value={+selectedModel.transform.y.toFixed(2)} step={0.5}
                          onChange={v => patchSelected({ y: v })} />
                      </Field>
                      <Field label="Z lift">
                        <NumInput value={+selectedModel.transform.z.toFixed(2)} min={0} max={buildVolume.height} step={0.5}
                          onChange={v => patchSelected({ z: v })} />
                      </Field>
                    </div>
                  </div>

                  {/* Rotation */}
                  <div className="space-y-1.5">
                    <label className="text-xs text-gray-400 font-medium">Rotation (°)</label>
                    <div className="grid grid-cols-3 gap-2">
                      <Field label="X (tilt)">
                        <NumInput value={+selectedModel.transform.rotX.toFixed(1)} step={1}
                          onChange={v => patchSelected({ rotX: v })} />
                      </Field>
                      <Field label="Y (tilt)">
                        <NumInput value={+selectedModel.transform.rotY.toFixed(1)} step={1}
                          onChange={v => patchSelected({ rotY: v })} />
                      </Field>
                      <Field label="Z (spin)">
                        <NumInput value={+selectedModel.transform.rotZ.toFixed(1)} step={1}
                          onChange={v => patchSelected({ rotZ: v })} />
                      </Field>
                    </div>
                  </div>

                  {/* Scale */}
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <label className="text-xs text-gray-400 font-medium">Scale</label>
                      <button
                        onClick={() => setUniformScale(u => !u)}
                        className={`text-xs px-2 py-0.5 rounded border transition
                          ${uniformScale
                            ? 'bg-indigo-800/60 border-indigo-600 text-indigo-200'
                            : 'bg-gray-800 border-gray-600 text-gray-400'}`}
                        title={uniformScale ? 'Uniform scale (locked)' : 'Non-uniform scale'}
                      >
                        {uniformScale ? '🔒 Uniform' : '🔓 Free'}
                      </button>
                    </div>
                    <div className="grid grid-cols-3 gap-2">
                      <Field label="X">
                        <NumInput value={+selectedModel.transform.scaleX.toFixed(3)} min={0.001} step={0.01}
                          onChange={v => patchScale('scaleX', v)} />
                      </Field>
                      <Field label="Y">
                        <NumInput value={+selectedModel.transform.scaleY.toFixed(3)} min={0.001} step={0.01}
                          onChange={v => patchScale('scaleY', v)} />
                      </Field>
                      <Field label="Z">
                        <NumInput value={+selectedModel.transform.scaleZ.toFixed(3)} min={0.001} step={0.01}
                          onChange={v => patchScale('scaleZ', v)} />
                      </Field>
                    </div>
                    {/* Quick scale presets */}
                    <div className="flex gap-1.5 flex-wrap mt-1">
                      {[50, 75, 100, 125, 150, 200].map(pct => (
                        <button
                          key={pct}
                          onClick={() => {
                            const s = pct / 100
                            updateTransform(selectedModel.id, { ...selectedModel.transform, scaleX: s, scaleY: s, scaleZ: s })
                          }}
                          className={`text-xs px-2 py-0.5 rounded border transition
                            ${Math.abs(selectedModel.transform.scaleX * 100 - pct) < 0.5
                              ? 'bg-indigo-700/60 border-indigo-500 text-white'
                              : 'bg-gray-800 border-gray-700 text-gray-400 hover:text-gray-200'}`}
                        >
                          {pct}%
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Placement buttons */}
                  <div className="space-y-2">
                    <div className="flex gap-2 flex-wrap">
                      <PosButton onClick={() => viewerRef.current?.centerOnBed()}>Center on Bed</PosButton>
                      <PosButton onClick={() => viewerRef.current?.placeOnBed()}>Place on Bed</PosButton>
                      <PosButton onClick={() => viewerRef.current?.resetTransform()}>Reset All</PosButton>
                    </div>

                    <button
                      onClick={() => viewerRef.current?.placeFaceOnBed()}
                      disabled={!hasFaceSelected}
                      className={`w-full py-2 text-sm rounded-lg font-medium transition-colors border
                        ${hasFaceSelected
                          ? 'bg-orange-600/80 hover:bg-orange-600 border-orange-500 text-white cursor-pointer'
                          : 'bg-gray-800 border-gray-700 text-gray-500 cursor-not-allowed opacity-50'}`}
                    >
                      Place Selected Face on Bed
                    </button>
                  </div>

                  {selectedModel.isOutOfBounds && (
                    <p className="text-xs text-red-400 bg-red-950/40 rounded-lg px-3 py-2">
                      Model outside build volume. Adjust position or scale.
                    </p>
                  )}
                </section>
              </>
            )}
          </>
        )}

        <div className="flex-1" />

        {/* Submit */}
        {models.length > 1 && (
          <p className="text-xs text-gray-500 text-center">
            Submitting: <span className="text-gray-300">{(selectedModel ?? models[0]).name}</span>
          </p>
        )}

        <button
          onClick={handleSubmit}
          disabled={!canSubmit}
          className="w-full py-2.5 bg-primary/80 hover:bg-primary disabled:opacity-40 disabled:cursor-not-allowed
                     text-white rounded-lg font-medium transition-colors"
        >
          {uploadMutation.isPending ? 'Uploading…' : 'Import STL & Create Job'}
        </button>

        {uploadMutation.isError && (
          <p className="text-red-400 text-sm">Upload failed. Check the console.</p>
        )}
      </div>
    </div>
  )
}

// ── Small helpers ──────────────────────────────────────────────────────────────

function SectionHeader({ children }: { children: React.ReactNode }) {
  return <h4 className="text-sm font-semibold text-white tracking-wide">{children}</h4>
}

function Divider() {
  return <hr className="border-gray-800" />
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <label className="text-xs text-gray-400">{label}</label>
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
      className="input text-sm"
      value={value}
      min={min}
      max={max}
      step={step}
      onChange={e => { const v = parseFloat(e.target.value); if (!isNaN(v)) onChange(v) }}
    />
  )
}

function PosButton({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className="px-3 py-1.5 text-xs rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-300
                 hover:text-white transition-colors border border-gray-700"
    >
      {children}
    </button>
  )
}
