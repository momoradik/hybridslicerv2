import { useState, useCallback, useEffect, useRef, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import StlViewer, {
  type BuildVolume,
  type ModelTransform,
  type ModelEntry,
  type StlViewerHandle,
  DEFAULT_TRANSFORM,
} from '../components/viewer/StlViewer'
import { jobsApi, machineProfilesApi, printProfilesApi, materialsApi } from '../api/client'
import { useMachineConnection } from '../hooks/useMachineConnection'
import { useAppStore } from '../store'

// ── Per-model state ───────────────────────────────────────────────────────────

interface ModelState extends ModelEntry {
  file: File
  size: { x: number; y: number; z: number } | null
  isOutOfBounds: boolean
}

// ── Module-level persistence (survives React navigation) ──────────────────────

interface SavedState {
  models: ModelState[]
  selectedId: string | null
  jobName: string
  machineId: string
  profileId: string
  materialId: string
  generatedJobId: string | null
  activeTab: 'import' | 'preview'
  supportEnabled: boolean
  supportType: 'normal' | 'tree'
}

const _initState: SavedState = {
  models: [], selectedId: null, jobName: '', machineId: '', profileId: '', materialId: '',
  generatedJobId: null, activeTab: 'import', supportEnabled: false, supportType: 'normal',
}
let _saved: SavedState = { ..._initState }

// ── Module-level undo stack ───────────────────────────────────────────────────

interface UndoEntry { modelId: string; transform: ModelTransform }
let _undoStack: UndoEntry[] = []

const pushUndo = (modelId: string, transform: ModelTransform) => {
  _undoStack.push({ modelId, transform: { ...transform } })
  if (_undoStack.length > 50) _undoStack.shift()
}

let idCounter = 0
const mkId = () => `model-${++idCounter}`

// ── Component ─────────────────────────────────────────────────────────────────

export default function StlImport() {
  const viewerRef  = useRef<StlViewerHandle>(null)
  const qc = useQueryClient()

  const [models, setModels]               = useState<ModelState[]>(() => _saved.models)
  const [selectedId, setSelectedId]       = useState<string | null>(() => _saved.selectedId)
  const [isDragOver, setIsDragOver]       = useState(false)
  const [hasFaceSelected, setHasFaceSelected] = useState(false)
  const [uniformScale, setUniformScale]   = useState(true)

  const [jobName, setJobName]             = useState(() => _saved.jobName)
  const [machineId, setMachineId]         = useState(() => _saved.machineId)
  const [profileId, setProfileId]         = useState(() => _saved.profileId)
  const [materialId, setMaterialId]       = useState(() => _saved.materialId)
  const [activeTab, setActiveTab]         = useState<'import' | 'preview'>(() => _saved.activeTab)
  const [generatedJobId, setGeneratedJobId] = useState<string | null>(() => _saved.generatedJobId)
  const [supportEnabled, setSupportEnabled] = useState(() => _saved.supportEnabled)
  const [supportType, setSupportType]     = useState<'normal' | 'tree'>(() => _saved.supportType)

  const [buildVolume, setBuildVolume]     = useState<BuildVolume>({ width: 220, depth: 220, height: 250 })

  // Machine profile modal state
  const [machineModal, setMachineModal]   = useState<'add' | 'rename' | null>(null)
  const [machineFormName, setMachineFormName] = useState('')
  const [machineFormBedW, setMachineFormBedW] = useState(220)
  const [machineFormBedD, setMachineFormBedD] = useState(220)
  const [machineFormBedH, setMachineFormBedH] = useState(250)
  const [machineFormNozzle, setMachineFormNozzle] = useState(0.4)
  const [machineFormExtruders, setMachineFormExtruders] = useState(1)
  const [machineFormIp, setMachineFormIp] = useState('')
  const [machineFormPort, setMachineFormPort] = useState(80)

  // Start Print state
  const [isPrinting, setIsPrinting]       = useState(false)
  const [printError, setPrintError]       = useState<string | null>(null)

  const { data: machines = [] } = useQuery({ queryKey: ['machines'], queryFn: machineProfilesApi.getAll })
  const { data: profiles = [] } = useQuery({ queryKey: ['printProfiles'], queryFn: printProfilesApi.getAll })
  const { data: materials = [] } = useQuery({ queryKey: ['materials'],     queryFn: materialsApi.getAll })

  const createMachineMutation = useMutation({
    mutationFn: (data: Parameters<typeof machineProfilesApi.create>[0]) => machineProfilesApi.create(data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['machines'] }); setMachineModal(null) },
  })
  const renameMachineMutation = useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) => machineProfilesApi.update(id, { name }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['machines'] }); setMachineModal(null) },
  })
  const deleteMachineMutation = useMutation({
    mutationFn: (id: string) => machineProfilesApi.delete(id),
    onSuccess: (_, id) => {
      qc.invalidateQueries({ queryKey: ['machines'] })
      if (machineId === id) setMachineId('')
    },
  })

  const uploadMutation = useMutation({
    mutationFn: (fd: FormData) => jobsApi.uploadStl(fd),
  })
  const sliceMutation = useMutation({
    mutationFn: (id: string) => jobsApi.slice(id),
  })

  const { sendCommand } = useMachineConnection()
  const machineConnected = useAppStore(s => s.machineConnected)

  // ── Persist state changes to module-level ──────────────────────────────────
  useEffect(() => { _saved.models = models }, [models])
  useEffect(() => { _saved.selectedId = selectedId }, [selectedId])
  useEffect(() => { _saved.jobName = jobName }, [jobName])
  useEffect(() => { _saved.machineId = machineId }, [machineId])
  useEffect(() => { _saved.profileId = profileId }, [profileId])
  useEffect(() => { _saved.materialId = materialId }, [materialId])
  useEffect(() => { _saved.activeTab = activeTab }, [activeTab])
  useEffect(() => { _saved.generatedJobId = generatedJobId }, [generatedJobId])
  useEffect(() => { _saved.supportEnabled = supportEnabled }, [supportEnabled])
  useEffect(() => { _saved.supportType = supportType }, [supportType])

  // Sync build volume from machine profile
  useEffect(() => {
    if (!machineId) return
    const m = machines.find(m => m.id === machineId)
    if (m) setBuildVolume({ width: m.bedWidthMm, depth: m.bedDepthMm, height: m.bedHeightMm })
  }, [machineId, machines])

  // Clear face-selected badge when selection changes
  useEffect(() => { setHasFaceSelected(false) }, [selectedId])

  // ── Keyboard shortcuts ────────────────────────────────────────────────────
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tag = (document.activeElement as HTMLElement)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return

      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selectedId) removeModel(selectedId)
        return
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
        e.preventDefault()
        const entry = _undoStack.pop()
        if (entry) {
          setModels(prev => prev.map(m => m.id === entry.modelId
            ? { ...m, transform: { ...entry.transform } } : m))
        }
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId])

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
    setModels(prev => {
      if (prev.length === 0) setJobName(entry.name)
      return [...prev, entry]
    })
    setSelectedId(id)
  }, [])

  const removeModel = (id: string) => {
    setModels(prev => {
      const next = prev.filter(m => m.id !== id)
      URL.revokeObjectURL(prev.find(m => m.id === id)?.url ?? '')
      return next
    })
    if (selectedId === id) setSelectedId(models.find(m => m.id !== id)?.id ?? null)
    _undoStack = _undoStack.filter(e => e.modelId !== id)
  }

  // Track time of last undo push per model (to batch drag transforms)
  const lastUndoPushTimeRef = useRef<Record<string, number>>({})

  const updateTransform = useCallback((id: string, t: ModelTransform) => {
    const now = Date.now()
    const last = lastUndoPushTimeRef.current[id] ?? 0
    setModels(prev => {
      if (now - last > 400) {
        const old = prev.find(m => m.id === id)
        if (old) pushUndo(id, old.transform)
        lastUndoPushTimeRef.current[id] = now
      }
      return prev.map(m => m.id === id ? { ...m, transform: t } : m)
    })
  }, [])

  const patchSelected = (patch: Partial<ModelTransform>) => {
    if (!selectedModel) return
    pushUndo(selectedModel.id, selectedModel.transform)
    const next = { ...selectedModel.transform, ...patch }
    setModels(prev => prev.map(m => m.id === selectedModel.id ? { ...m, transform: next } : m))
  }

  const patchScale = (axis: 'scaleX' | 'scaleY' | 'scaleZ', val: number) => {
    if (!selectedModel) return
    pushUndo(selectedModel.id, selectedModel.transform)
    const base = selectedModel.transform
    const next = uniformScale
      ? { ...base, scaleX: val, scaleY: val, scaleZ: val }
      : { ...base, [axis]: val }
    setModels(prev => prev.map(m => m.id === selectedModel.id ? { ...m, transform: next } : m))
  }

  // ── Viewer callbacks ───────────────────────────────────────────────────────

  const handleModelLoaded = useCallback((id: string, size: { x: number; y: number; z: number }) => {
    setModels(prev => prev.map(m => m.id === id ? { ...m, size } : m))
  }, [])

  const handleSizeChange = useCallback((id: string, size: { x: number; y: number; z: number }) => {
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

  // ── Submit (Generate G-code) ───────────────────────────────────────────────

  const handleSubmit = async () => {
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
    fd.append('supportEnabled', supportEnabled.toString())
    fd.append('supportType', supportType)
    const { jobId } = await uploadMutation.mutateAsync(fd)
    await sliceMutation.mutateAsync(jobId)
    setGeneratedJobId(jobId)
    setActiveTab('preview')
  }

  // ── Start Print ────────────────────────────────────────────────────────────

  const handleStartPrint = async () => {
    if (!generatedJobId || !machineConnected) return
    setIsPrinting(true)
    setPrintError(null)
    try {
      const gcode = await jobsApi.getPrintGCode(generatedJobId)
      const lines = gcode.split('\n').filter(l => l.trim() && !l.startsWith(';'))
      for (const line of lines) {
        await sendCommand(line)
      }
    } catch (err) {
      setPrintError(err instanceof Error ? err.message : 'Print failed')
    } finally {
      setIsPrinting(false)
    }
  }

  const canSubmit = models.length > 0 && !!machineId && !!profileId && !!materialId && !!jobName
    && !uploadMutation.isPending && !sliceMutation.isPending
  const anyOOB    = models.some(m => m.isOutOfBounds)

  const effectiveSize = selectedModel?.size ?? null

  // ── Machine profile modal helpers ─────────────────────────────────────────

  const openAddMachine = () => {
    setMachineFormName(''); setMachineFormBedW(220); setMachineFormBedD(220); setMachineFormBedH(250)
    setMachineFormNozzle(0.4); setMachineFormExtruders(1); setMachineFormIp(''); setMachineFormPort(80)
    setMachineModal('add')
  }

  const openRenameMachine = () => {
    const m = machines.find(m => m.id === machineId)
    if (!m) return
    setMachineFormName(m.name)
    setMachineModal('rename')
  }

  const submitMachineModal = () => {
    if (machineModal === 'add') {
      createMachineMutation.mutate({
        name: machineFormName,
        type: 'Hybrid' as const,
        bedWidthMm: machineFormBedW,
        bedDepthMm: machineFormBedD,
        bedHeightMm: machineFormBedH,
        nozzleDiameterMm: machineFormNozzle,
        extruderCount: machineFormExtruders,
        ipAddress: machineFormIp || undefined,
        port: machineFormPort,
      })
    } else if (machineModal === 'rename') {
      renameMachineMutation.mutate({ id: machineId, name: machineFormName })
    }
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col gap-0 h-[calc(100vh-8rem)]">
      <div className="flex border-b border-gray-800 mb-4 flex-shrink-0">
        <TabBtn active={activeTab === 'import'} onClick={() => setActiveTab('import')}>Import STL</TabBtn>
        <TabBtn active={activeTab === 'preview'} disabled={!generatedJobId} onClick={() => setActiveTab('preview')}>G-code Preview</TabBtn>
      </div>

      {activeTab === 'preview' && generatedJobId ? (
        <div className="flex flex-col gap-3 flex-1 min-h-0">
          <div className="flex items-center gap-3">
            {machineConnected ? (
              <button
                onClick={handleStartPrint}
                disabled={isPrinting}
                className="px-4 py-2 text-sm rounded-lg bg-green-700/80 hover:bg-green-700 disabled:opacity-40
                           text-white font-medium transition border border-green-600"
              >
                {isPrinting ? 'Printing…' : 'Start Print'}
              </button>
            ) : (
              <span className="text-xs text-gray-500 italic">Machine not connected — cannot start print</span>
            )}
            <Link
              to={`/jobs/${generatedJobId}/gcode`}
              className="px-3 py-1.5 text-xs rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-300 border border-gray-700 transition"
            >
              View Full G-code
            </Link>
            {printError && <span className="text-red-400 text-xs">{printError}</span>}
          </div>
          <GCodePreview jobId={generatedJobId} />
        </div>
      ) : (
      <div className="grid grid-cols-2 gap-6 flex-1 min-h-0">

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
              onSizeChange={handleSizeChange}
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
                Click to select · Dbl-click for transform handles · Delete to remove · Ctrl+Z to undo
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

          {/* Machine Profile with inline management */}
          <Field label="Machine Profile">
            <div className="flex gap-1.5">
              <select className="input flex-1" value={machineId} onChange={e => setMachineId(e.target.value)}>
                <option value="">Select…</option>
                {machines.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
              </select>
              <button
                onClick={openAddMachine}
                className="px-2 py-1 text-xs rounded bg-gray-800 hover:bg-gray-700 border border-gray-700 text-gray-400 hover:text-gray-200 transition"
                title="Add machine profile"
              >+</button>
              {machineId && <>
                <button
                  onClick={openRenameMachine}
                  className="px-2 py-1 text-xs rounded bg-gray-800 hover:bg-gray-700 border border-gray-700 text-gray-400 hover:text-gray-200 transition"
                  title="Rename"
                >✏</button>
                <button
                  onClick={() => { if (confirm('Delete this machine profile?')) deleteMachineMutation.mutate(machineId) }}
                  className="px-2 py-1 text-xs rounded bg-gray-800 hover:bg-red-900/60 border border-gray-700 text-gray-400 hover:text-red-300 transition"
                  title="Delete"
                >✕</button>
              </>}
            </div>
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

        {/* Support Settings */}
        <section className="space-y-2">
          <SectionHeader>Support</SectionHeader>
          <label className="flex items-center gap-2 text-sm text-gray-300 cursor-pointer">
            <input
              type="checkbox"
              checked={supportEnabled}
              onChange={e => setSupportEnabled(e.target.checked)}
              className="accent-primary"
            />
            Enable Support
          </label>
          {supportEnabled && (
            <div className="flex gap-3 mt-1">
              {(['normal', 'tree'] as const).map(t => (
                <label key={t} className="flex items-center gap-1.5 text-sm text-gray-300 cursor-pointer">
                  <input
                    type="radio"
                    name="supportType"
                    value={t}
                    checked={supportType === t}
                    onChange={() => setSupportType(t)}
                    className="accent-primary"
                  />
                  {t.charAt(0).toUpperCase() + t.slice(1)}
                </label>
              ))}
            </div>
          )}
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
                    <span className={`w-2 h-2 rounded-full flex-shrink-0 ${m.isOutOfBounds ? 'bg-red-500' : 'bg-green-500'}`} />
                    <span className="truncate flex-1">{m.name}</span>
                    {m.size && (
                      <span className="text-gray-500 flex-shrink-0">
                        {m.size.x.toFixed(0)}×{m.size.y.toFixed(0)}×{m.size.z.toFixed(0)}
                      </span>
                    )}
                    <button
                      onClick={e => { e.stopPropagation(); removeModel(m.id) }}
                      className="text-gray-600 hover:text-red-400 transition ml-1 flex-shrink-0"
                      title="Remove"
                    >✕</button>
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
                    <div className="flex gap-1.5 flex-wrap mt-1">
                      {[50, 75, 100, 125, 150, 200].map(pct => (
                        <button
                          key={pct}
                          onClick={() => {
                            pushUndo(selectedModel.id, selectedModel.transform)
                            const s = pct / 100
                            setModels(prev => prev.map(m => m.id === selectedModel.id
                              ? { ...m, transform: { ...m.transform, scaleX: s, scaleY: s, scaleZ: s } } : m))
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
          {uploadMutation.isPending ? 'Uploading…' : sliceMutation.isPending ? 'Generating…' : 'Generate G-code'}
        </button>

        {(uploadMutation.isError || sliceMutation.isError) && (
          <p className="text-red-400 text-sm whitespace-pre-wrap">
            {uploadMutation.isError
              ? 'Upload failed.'
              : `Slicing failed: ${
                  (sliceMutation.error as any)?.response?.data?.detail
                  ?? (sliceMutation.error as any)?.response?.data?.message
                  ?? (sliceMutation.error as any)?.message
                  ?? 'Unknown error'
                }`}
          </p>
        )}
      </div>
      </div>
      )}

      {/* ── Machine Profile Modal ─────────────────────────────────────────── */}
      {machineModal && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
          <div className="bg-gray-900 border border-gray-700 rounded-xl p-6 w-full max-w-lg space-y-4">
            <h3 className="font-semibold text-white">
              {machineModal === 'add' ? 'Add Machine Profile' : 'Rename Machine Profile'}
            </h3>

            <MField label="Name">
              <input className="input w-full" value={machineFormName}
                onChange={e => setMachineFormName(e.target.value)} placeholder="My Machine" />
            </MField>

            {machineModal === 'add' && (<>
              <div className="grid grid-cols-3 gap-3">
                <MField label="Bed Width (mm)">
                  <NumInput value={machineFormBedW} min={1} max={2000} onChange={setMachineFormBedW} />
                </MField>
                <MField label="Bed Depth (mm)">
                  <NumInput value={machineFormBedD} min={1} max={2000} onChange={setMachineFormBedD} />
                </MField>
                <MField label="Bed Height (mm)">
                  <NumInput value={machineFormBedH} min={1} max={2000} onChange={setMachineFormBedH} />
                </MField>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <MField label="Nozzle Diameter (mm)">
                  <NumInput value={machineFormNozzle} min={0.1} max={2} step={0.1} onChange={setMachineFormNozzle} />
                </MField>
                <MField label="Extruder Count">
                  <NumInput value={machineFormExtruders} min={1} max={8} onChange={setMachineFormExtruders} />
                </MField>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <MField label="IP Address (optional)">
                  <input className="input w-full" value={machineFormIp}
                    onChange={e => setMachineFormIp(e.target.value)} placeholder="192.168.1.100" />
                </MField>
                <MField label="Port">
                  <NumInput value={machineFormPort} min={1} max={65535} onChange={setMachineFormPort} />
                </MField>
              </div>
            </>)}

            <div className="flex gap-3 justify-end pt-2">
              <button onClick={() => setMachineModal(null)}
                className="px-4 py-2 bg-gray-800 text-gray-300 rounded-lg text-sm">Cancel</button>
              <button
                onClick={submitMachineModal}
                disabled={!machineFormName.trim() || createMachineMutation.isPending || renameMachineMutation.isPending}
                className="px-4 py-2 bg-primary/80 hover:bg-primary disabled:opacity-40 text-white rounded-lg text-sm"
              >
                {createMachineMutation.isPending || renameMachineMutation.isPending ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}
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

function TabBtn({ active, disabled, onClick, children }: {
  active: boolean; disabled?: boolean; onClick: () => void; children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`px-5 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors
        ${active
          ? 'border-primary text-white'
          : 'border-transparent text-gray-500 hover:text-gray-300 disabled:opacity-30 disabled:cursor-not-allowed'}`}
    >
      {children}
    </button>
  )
}

function GCodePreview({ jobId }: { jobId: string }) {
  const { data: gcode, isLoading, isError } = useQuery({
    queryKey: ['print-gcode', jobId],
    queryFn: () => jobsApi.getPrintGCode(jobId),
  })

  const layers = useMemo(() => {
    if (!gcode) return []
    const result: string[][] = []
    let current: string[] = []
    for (const line of gcode.split('\n')) {
      if (line.startsWith(';LAYER:')) {
        if (current.length > 0) result.push(current)
        current = [line]
      } else {
        current.push(line)
      }
    }
    if (current.length > 0) result.push(current)
    return result
  }, [gcode])

  const [layerIdx, setLayerIdx] = useState(0)

  if (isLoading) return <p className="text-gray-400 p-4">Loading G-code…</p>
  if (isError || !gcode) return <p className="text-red-400 p-4">Failed to load G-code.</p>

  const layer = layers[layerIdx] ?? []

  return (
    <div className="flex flex-col gap-4 flex-1 min-h-0">
      <div className="flex items-center gap-4">
        <span className="text-sm text-gray-400 whitespace-nowrap">
          Layer {layerIdx + 1} / {layers.length}
        </span>
        <input
          type="range"
          min={0} max={Math.max(0, layers.length - 1)}
          value={layerIdx}
          onChange={e => setLayerIdx(+e.target.value)}
          className="flex-1 accent-primary"
        />
      </div>
      <pre className="flex-1 min-h-0 overflow-auto bg-gray-950 text-green-400 text-xs p-4 rounded-xl font-mono">
        {layer.join('\n')}
      </pre>
    </div>
  )
}
