import { useState, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { jobsApi, toolsApi } from '../api/client'
import GCodePreview3D from '../components/viewer/GCodePreview3D'
import CncSimulation from '../components/viewer/CncSimulation'

type Tab = 'config' | 'gcode' | 'preview3d' | 'simulation'

interface UnmachinableRegion {
  zHeightMm: number
  reason: string
  bounds: { minX: number; minY: number; maxX: number; maxY: number }
}

export default function HybridPlanner() {
  const qc = useQueryClient()
  const { data: jobs  = [] } = useQuery({ queryKey: ['jobs'],  queryFn: jobsApi.getAll })
  const { data: tools = [] } = useQuery({ queryKey: ['tools'], queryFn: toolsApi.getAll })

  const [jobId,                 setJobId]                 = useState('')
  const [toolId,                setToolId]                = useState('')
  const [machineEveryN,         setMachineEveryN]         = useState(10)
  const [machineInnerWalls,     setMachineInnerWalls]     = useState(false)
  const [avoidSupports,         setAvoidSupports]         = useState(false)
  const [supportClearanceMm,    setSupportClearanceMm]    = useState(2.0)
  const [autoMachiningFrequency, setAutoMachiningFrequency] = useState(false)
  const [activeTab,             setActiveTab]             = useState<Tab>('config')
  const [toolpathGCode,         setToolpathGCode]         = useState<string | null>(null)
  const [printGCode,            setPrintGCode]            = useState<string | null>(null)
  const [machinedLayers,        setMachinedLayers]        = useState<number[]>([])
  const [unmachinableRegions,   setUnmachinableRegions]   = useState<UnmachinableRegion[]>([])

  const readyJobs   = jobs.filter(j => j.status === 'SlicingComplete' || j.status === 'ToolpathsComplete')
  const selectedJob  = jobs.find(j => j.id === jobId)
  const selectedTool = tools.find(t => t.id === toolId)

  const toolpathsMutation = useMutation({
    mutationFn: () =>
      jobsApi.generateToolpaths(
        jobId, toolId, machineEveryN, machineInnerWalls, avoidSupports,
        supportClearanceMm, autoMachiningFrequency
      ),
    onSuccess: async (result: any) => {
      qc.invalidateQueries({ queryKey: ['jobs'] })
      if (result?.machinedAtLayers) setMachinedLayers(result.machinedAtLayers)
      if (result?.unmachinableRegions) setUnmachinableRegions(result.unmachinableRegions)
      else setUnmachinableRegions([])
      const gcode = await jobsApi.getToolpathGCode(jobId)
      setToolpathGCode(gcode)
      const pg = await jobsApi.getPrintGCode(jobId)
      setPrintGCode(pg)
      setActiveTab('gcode')
    },
  })

  const planMutation = useMutation({
    mutationFn: () => jobsApi.planHybrid(jobId, machineEveryN),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['jobs'] }),
  })

  const downloadGCode = async () => {
    const blob = await jobsApi.downloadGCode(jobId)
    const url  = URL.createObjectURL(blob)
    const a    = document.createElement('a')
    a.href     = url
    a.download = `hybrid_${jobId}.gcode`
    a.click()
    URL.revokeObjectURL(url)
  }

  // Dummy build volume for the 3D preview (CNC toolpaths don't need a real bed size)
  const buildVolume = useMemo(() => ({ width: 440, depth: 290, height: 350 }), [])

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-semibold text-white">Hybrid Process Planner</h2>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-gray-800">
        <TabBtn active={activeTab === 'config'} onClick={() => setActiveTab('config')}>
          Configuration
        </TabBtn>
        <TabBtn
          active={activeTab === 'gcode'}
          disabled={!toolpathGCode}
          onClick={() => setActiveTab('gcode')}
        >
          G-code Text
          {toolpathGCode && (
            <span className="ml-2 px-1.5 py-0.5 text-xs bg-purple-700 rounded-full">CNC</span>
          )}
        </TabBtn>
        <TabBtn
          active={activeTab === 'preview3d'}
          disabled={!toolpathGCode}
          onClick={() => setActiveTab('preview3d')}
        >
          3D Preview
          {toolpathGCode && (
            <span className="ml-2 px-1.5 py-0.5 text-xs bg-cyan-700 rounded-full">NEW</span>
          )}
        </TabBtn>
        <TabBtn
          active={activeTab === 'simulation'}
          disabled={!toolpathGCode || !printGCode}
          onClick={() => setActiveTab('simulation')}
        >
          Simulation
          {toolpathGCode && printGCode && (
            <span className="ml-2 px-1.5 py-0.5 text-xs bg-green-700 rounded-full">SIM</span>
          )}
        </TabBtn>
      </div>

      {activeTab === 'config' && (
        <div className="grid grid-cols-2 gap-6">
          {/* Left: controls */}
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-6 space-y-5">
            <h3 className="font-medium text-white">Configuration</h3>

            <Field label="Job (must be sliced)">
              <select className="input" value={jobId} onChange={e => setJobId(e.target.value)}>
                <option value="">Select…</option>
                {readyJobs.map(j => (
                  <option key={j.id} value={j.id}>{j.name} ({j.status})</option>
                ))}
              </select>
            </Field>

            <Field label="CNC Tool">
              <select className="input" value={toolId} onChange={e => setToolId(e.target.value)}>
                <option value="">Select…</option>
                {tools.map(t => (
                  <option key={t.id} value={t.id}>{t.name} (Ø{t.diameterMm} mm)</option>
                ))}
              </select>
            </Field>

            {!autoMachiningFrequency && (
              <Field label={`Machine every N layers (N = ${machineEveryN})`}>
                <div className="flex items-center gap-2">
                  <input
                    type="range"
                    min={1} max={100} step={1}
                    value={machineEveryN}
                    onChange={e => setMachineEveryN(+e.target.value)}
                    className="flex-1 accent-primary"
                  />
                  <input
                    type="number"
                    min={1} max={100}
                    value={machineEveryN}
                    onChange={e => setMachineEveryN(Math.max(1, Math.min(100, +e.target.value)))}
                    className="input w-16 text-center"
                  />
                </div>
                <div className="flex justify-between text-xs text-gray-500 mt-1">
                  <span>Every layer</span><span>Every 100 layers</span>
                </div>
              </Field>
            )}

            {autoMachiningFrequency && selectedTool && (
              <div className="bg-blue-950/40 border border-blue-800 rounded-lg px-3 py-2 text-xs text-blue-300">
                With &Oslash;{selectedTool.diameterMm}mm tool (flute: {selectedTool.fluteLengthMm}mm): machines approx every{' '}
                {selectedJob
                  ? (() => {
                      // Estimate interval based on 0.2mm default or known layer height
                      const layerH = 0.2
                      const interval = Math.floor((selectedTool.fluteLengthMm * 0.8) / layerH)
                      return interval
                    })()
                  : '?'}{' '}
                layers at 0.2mm/layer
              </div>
            )}

            {/* CNC options */}
            <div className="space-y-3 border border-gray-700 rounded-lg p-4">
              <p className="text-xs text-gray-400 font-medium uppercase tracking-wide">CNC Options</p>

              <label className="flex items-center gap-3 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={autoMachiningFrequency}
                  onChange={e => setAutoMachiningFrequency(e.target.checked)}
                  className="w-4 h-4 accent-blue-500"
                />
                <div>
                  <div className="text-sm text-gray-200">Auto Machining Frequency</div>
                  <div className="text-xs text-gray-500">Machine only when lower geometry becomes unreachable (uses flute length)</div>
                </div>
              </label>

              <label className="flex items-center gap-3 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={machineInnerWalls}
                  onChange={e => setMachineInnerWalls(e.target.checked)}
                  className="w-4 h-4 accent-purple-500"
                />
                <div>
                  <div className="text-sm text-gray-200">Machine inner surfaces</div>
                  <div className="text-xs text-gray-500">Also run CNC on inner-wall paths (holes, pockets)</div>
                </div>
              </label>

              <label className="flex items-center gap-3 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={avoidSupports}
                  onChange={e => setAvoidSupports(e.target.checked)}
                  className="w-4 h-4 accent-purple-500"
                />
                <div>
                  <div className="text-sm text-gray-200">Avoid supports</div>
                  <div className="text-xs text-gray-500">Clip toolpaths around support regions (no-cut zones)</div>
                </div>
              </label>

              {avoidSupports && (
                <div className="ml-7 flex items-center gap-3">
                  <label className="text-xs text-gray-400 whitespace-nowrap">Support XY clearance</label>
                  <input
                    type="number"
                    min={0.1} max={20} step={0.1}
                    value={supportClearanceMm}
                    onChange={e => setSupportClearanceMm(Math.max(0.1, Math.min(20, +e.target.value)))}
                    className="input w-20 text-center"
                  />
                  <span className="text-xs text-gray-500">mm</span>
                  <span className="text-xs text-gray-600">(tool stays this far from supports)</span>
                </div>
              )}
            </div>

            <div className="flex gap-3 pt-2">
              <button
                onClick={() => toolpathsMutation.mutate()}
                disabled={!jobId || !toolId || toolpathsMutation.isPending}
                className="flex-1 py-2 bg-purple-700 hover:bg-purple-600 disabled:opacity-40 text-white rounded-lg text-sm transition"
              >
                {toolpathsMutation.isPending ? 'Generating…' : '1. Generate Toolpaths'}
              </button>

              <button
                onClick={() => planMutation.mutate()}
                disabled={!jobId || selectedJob?.status !== 'ToolpathsComplete' || planMutation.isPending}
                className="flex-1 py-2 bg-primary/80 hover:bg-primary disabled:opacity-40 text-white rounded-lg text-sm transition"
              >
                {planMutation.isPending ? 'Planning…' : '2. Plan Hybrid'}
              </button>
            </div>

            {toolpathsMutation.isError && (
              <div className="bg-red-950/40 border border-red-800 rounded-lg px-3 py-2 text-xs text-red-400">
                {(toolpathsMutation.error as any)?.response?.data?.detail
                  ?? (toolpathsMutation.error as Error)?.message
                  ?? 'Toolpath generation failed'}
              </div>
            )}

            {unmachinableRegions.length > 0 && (
              <div className="bg-yellow-950/40 border border-yellow-700 rounded-lg px-3 py-2 text-xs text-yellow-300">
                <div className="font-semibold mb-1">
                  ⚠ {unmachinableRegions.length} region{unmachinableRegions.length !== 1 ? 's' : ''} could not be machined:{' '}
                  {(() => {
                    const counts: Record<string, number> = {}
                    for (const r of unmachinableRegions) counts[r.reason] = (counts[r.reason] ?? 0) + 1
                    return Object.entries(counts).map(([reason, count]) => `${count}× ${reason}`).join(', ')
                  })()}
                </div>
                <div className="text-yellow-500">
                  Check tool diameter vs. feature width, flute length vs. part height, and support clearance settings.
                </div>
              </div>
            )}

            {selectedJob?.status === 'Ready' && (
              <button
                onClick={downloadGCode}
                className="w-full py-2 bg-green-700 hover:bg-green-600 text-white rounded-lg text-sm transition"
              >
                Download Hybrid G-code
              </button>
            )}

            {toolpathsMutation.isSuccess && toolpathGCode && (
              <div className="flex gap-2">
                <button
                  onClick={() => setActiveTab('gcode')}
                  className="flex-1 py-2 bg-purple-900 hover:bg-purple-800 border border-purple-600 text-purple-300 rounded-lg text-sm transition"
                >
                  View G-code Text →
                </button>
                <button
                  onClick={() => setActiveTab('preview3d')}
                  className="flex-1 py-2 bg-cyan-900 hover:bg-cyan-800 border border-cyan-600 text-cyan-300 rounded-lg text-sm transition"
                >
                  3D Preview →
                </button>
              </div>
            )}
          </div>

          {/* Right: process plan visualiser */}
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-6">
            <h3 className="font-medium text-white mb-4">Process Preview</h3>
            {selectedJob ? (
              <div className="space-y-1 text-sm font-mono text-gray-400 max-h-96 overflow-y-auto">
                {selectedJob.totalPrintLayers && Array.from(
                  { length: Math.ceil(selectedJob.totalPrintLayers / machineEveryN) },
                  (_, i) => {
                    const end   = (i + 1) * machineEveryN
                    const start = i * machineEveryN + 1
                    const isMachined = machinedLayers.includes(Math.min(end, selectedJob.totalPrintLayers!))
                    return (
                      <div key={i} className="space-y-0.5">
                        <div className="text-blue-400">
                          ▣ Print L{start}–L{Math.min(end, selectedJob.totalPrintLayers!)}
                        </div>
                        <div className={`pl-4 ${isMachined ? 'text-orange-400' : 'text-gray-600'}`}>
                          ⚙ CNC @ L{Math.min(end, selectedJob.totalPrintLayers!)}
                          {isMachined && ' ✓'}
                        </div>
                      </div>
                    )
                  }
                )}
              </div>
            ) : (
              <p className="text-gray-600">Select a sliced job to preview the process plan.</p>
            )}
          </div>
        </div>
      )}

      {activeTab === 'gcode' && toolpathGCode && (
        <GCodeTextPanel
          gcode={toolpathGCode}
          machinedLayers={machinedLayers}
          jobName={selectedJob?.name ?? ''}
          onShow3D={() => setActiveTab('preview3d')}
        />
      )}

      {activeTab === 'preview3d' && toolpathGCode && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-white font-medium">CNC Toolpath — 3D Preview</h3>
            <div className="flex gap-3 text-xs text-gray-500">
              <span><span className="text-cyan-400">■</span> Rapid (G0)</span>
              <span><span className="text-yellow-300">■</span> Cut (G1)</span>
              <span><span className="text-blue-400">■</span> Printed geometry</span>
              <span><span className="text-orange-400">■</span> Support material</span>
              <span><span className="text-red-400">■</span> Unmachinable</span>
              <span className="text-gray-600">{machinedLayers.length} layers machined</span>
            </div>
          </div>
          <div className="bg-gray-950 rounded-xl border border-gray-700 overflow-hidden" style={{ height: '70vh' }}>
            <GCodePreview3D
              gcode={toolpathGCode}
              buildVolume={buildVolume}
              lineWidth={0.4}
              className="w-full h-full"
            />
          </div>
        </div>
      )}

      {activeTab === 'simulation' && toolpathGCode && printGCode && (
        <CncSimulation
          toolpathGCode={toolpathGCode}
          printGCode={printGCode}
          buildVolume={buildVolume}
          toolDiameterMm={selectedTool?.diameterMm ?? 3}
          unmachinableRegions={unmachinableRegions}
          className="flex-1"
        />
      )}
    </div>
  )
}

// ── G-code Text Panel ────────────────────────────────────────────────────────

function GCodeTextPanel({
  gcode, machinedLayers, jobName, onShow3D,
}: {
  gcode: string
  machinedLayers: number[]
  jobName: string
  onShow3D: () => void
}) {
  const lines = useMemo(() => gcode.split('\n'), [gcode])

  const stats = useMemo(() => {
    const moves        = lines.filter(l => /^G0[01]\s/i.test(l)).length
    const spindleStarts = lines.filter(l => /^M0?3\b/i.test(l)).length
    return { totalLines: lines.length, moves, spindleStarts }
  }, [lines])

  const colorLine = (line: string): React.ReactNode => {
    const trimmed = line.trimEnd()
    if (!trimmed) return <span>&nbsp;</span>
    if (trimmed.startsWith(';'))
      return <span className="text-gray-500 italic">{trimmed}</span>

    const ci      = trimmed.indexOf(';')
    const cmd     = ci >= 0 ? trimmed.slice(0, ci).trimEnd() : trimmed
    const comment = ci >= 0 ? trimmed.slice(ci) : ''
    if (!cmd) return <span className="text-gray-500 italic">{trimmed}</span>

    const colored = cmd.split(/\s+/).map((token, i) => {
      const u = token.toUpperCase()
      if (/^G0[01]$/.test(u))          return <span key={i} className="text-cyan-400">{token} </span>
      if (/^G0[23]$/.test(u))          return <span key={i} className="text-cyan-300">{token} </span>
      if (/^G\d+$/.test(u))            return <span key={i} className="text-cyan-500">{token} </span>
      if (/^M0?3$/.test(u))            return <span key={i} className="text-green-400">{token} </span>
      if (/^M0?5$/.test(u))            return <span key={i} className="text-red-400">{token} </span>
      if (/^M\d+$/.test(u))            return <span key={i} className="text-purple-400">{token} </span>
      if (/^[XYZIJ]-?[\d.]+$/.test(u)) return <span key={i} className="text-yellow-300">{token} </span>
      if (/^F[\d.]+$/.test(u))         return <span key={i} className="text-orange-300">{token} </span>
      if (/^S[\d.]+$/.test(u))         return <span key={i} className="text-green-300">{token} </span>
      return <span key={i} className="text-gray-200">{token} </span>
    })

    return (
      <>
        {colored}
        {comment && <span className="text-gray-500 italic">{comment}</span>}
      </>
    )
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-4 gap-4">
        <StatCard label="Layers machined" value={machinedLayers.length}            color="purple" />
        <StatCard label="Total G-code lines" value={stats.totalLines.toLocaleString()} color="blue" />
        <StatCard label="Move commands"    value={stats.moves.toLocaleString()}    color="cyan" />
        <StatCard label="Spindle starts"   value={stats.spindleStarts}             color="green" />
      </div>

      <div className="flex justify-end">
        <button
          onClick={onShow3D}
          className="px-4 py-2 bg-cyan-800 hover:bg-cyan-700 text-cyan-200 rounded-lg text-sm border border-cyan-600 transition"
        >
          Switch to 3D Preview →
        </button>
      </div>

      <div className="bg-gray-950 border border-gray-800 rounded-xl overflow-hidden">
        <div className="flex items-center justify-between px-4 py-2 border-b border-gray-800 bg-gray-900">
          <span className="text-sm text-gray-400 font-mono">toolpath.gcode — {jobName}</span>
          <div className="flex gap-3 text-xs text-gray-600">
            <span><span className="text-cyan-400">■</span> G-code</span>
            <span><span className="text-yellow-300">■</span> Coords</span>
            <span><span className="text-green-400">■</span> Spindle on</span>
            <span><span className="text-red-400">■</span> Spindle off</span>
          </div>
        </div>
        <div className="overflow-auto max-h-[60vh] text-xs font-mono leading-5">
          <table className="w-full border-collapse">
            <tbody>
              {lines.map((line, i) => (
                <tr key={i} className="hover:bg-gray-900/50">
                  <td className="select-none text-right text-gray-700 px-3 py-px w-12 border-r border-gray-800/50">
                    {i + 1}
                  </td>
                  <td className="px-4 py-px whitespace-pre">{colorLine(line)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

function StatCard({ label, value, color }: { label: string; value: string | number; color: string }) {
  const colors: Record<string, string> = {
    purple: 'text-purple-400 border-purple-800',
    blue:   'text-blue-400   border-blue-800',
    cyan:   'text-cyan-400   border-cyan-800',
    green:  'text-green-400  border-green-800',
  }
  return (
    <div className={`bg-gray-900 border rounded-xl p-4 ${colors[color] ?? colors.blue}`}>
      <div className="text-2xl font-bold">{value}</div>
      <div className="text-xs text-gray-500 mt-1">{label}</div>
    </div>
  )
}

function TabBtn({ active, disabled, onClick, children }: {
  active: boolean; disabled?: boolean; onClick: () => void; children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={[
        'flex items-center gap-1 px-4 py-2 text-sm rounded-t-lg border-b-2 transition',
        active ? 'border-primary text-white' : 'border-transparent text-gray-500 hover:text-gray-300',
        disabled ? 'opacity-40 cursor-not-allowed' : '',
      ].join(' ')}
    >
      {children}
    </button>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <label className="text-sm text-gray-400">{label}</label>
      {children}
    </div>
  )
}
