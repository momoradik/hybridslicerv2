import { useState, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { jobsApi, toolsApi } from '../api/client'

type Tab = 'config' | 'gcode'

export default function HybridPlanner() {
  const qc = useQueryClient()
  const { data: jobs = [] } = useQuery({ queryKey: ['jobs'], queryFn: jobsApi.getAll })
  const { data: tools = [] } = useQuery({ queryKey: ['tools'], queryFn: toolsApi.getAll })

  const [jobId, setJobId] = useState('')
  const [toolId, setToolId] = useState('')
  const [machineEveryN, setMachineEveryN] = useState(10)
  const [activeTab, setActiveTab] = useState<Tab>('config')
  const [toolpathGCode, setToolpathGCode] = useState<string | null>(null)
  const [machinedLayers, setMachinedLayers] = useState<number[]>([])

  const readyJobs = jobs.filter(j => j.status === 'SlicingComplete' || j.status === 'ToolpathsComplete')
  const selectedJob = jobs.find(j => j.id === jobId)

  const toolpathsMutation = useMutation({
    mutationFn: () => jobsApi.generateToolpaths(jobId, toolId, machineEveryN),
    onSuccess: async (result: any) => {
      qc.invalidateQueries({ queryKey: ['jobs'] })
      if (result?.machinedAtLayers) setMachinedLayers(result.machinedAtLayers)
      const gcode = await jobsApi.getToolpathGCode(jobId)
      setToolpathGCode(gcode)
      setActiveTab('gcode')
    },
  })

  const planMutation = useMutation({
    mutationFn: () => jobsApi.planHybrid(jobId, machineEveryN),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['jobs'] }),
  })

  const downloadGCode = async () => {
    const blob = await jobsApi.downloadGCode(jobId)
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `hybrid_${jobId}.gcode`
    a.click()
    URL.revokeObjectURL(url)
  }

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
          G-code Preview
          {toolpathGCode && (
            <span className="ml-2 px-1.5 py-0.5 text-xs bg-purple-700 rounded-full">CNC</span>
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

            <Field label={`Machine every N layers (N = ${machineEveryN})`}>
              <input
                type="range"
                min={1} max={100} step={1}
                value={machineEveryN}
                onChange={e => setMachineEveryN(+e.target.value)}
                className="w-full accent-primary"
              />
              <div className="flex justify-between text-xs text-gray-500 mt-1">
                <span>Every layer</span><span>Every 100 layers</span>
              </div>
            </Field>

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

            {selectedJob?.status === 'Ready' && (
              <button
                onClick={downloadGCode}
                className="w-full py-2 bg-green-700 hover:bg-green-600 text-white rounded-lg text-sm transition"
              >
                Download Hybrid G-code
              </button>
            )}

            {toolpathsMutation.isSuccess && toolpathGCode && (
              <button
                onClick={() => setActiveTab('gcode')}
                className="w-full py-2 bg-purple-900 hover:bg-purple-800 border border-purple-600 text-purple-300 rounded-lg text-sm transition"
              >
                View CNC G-code Preview →
              </button>
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
                    const end = (i + 1) * machineEveryN
                    const start = i * machineEveryN + 1
                    return (
                      <div key={i} className="space-y-0.5">
                        <div className="text-blue-400">▣ Print L{start}–L{Math.min(end, selectedJob.totalPrintLayers!)}</div>
                        <div className="text-orange-400 pl-4">⚙ CNC @ L{Math.min(end, selectedJob.totalPrintLayers!)}</div>
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
        <GCodePreviewPanel
          gcode={toolpathGCode}
          machinedLayers={machinedLayers}
          jobName={selectedJob?.name ?? ''}
        />
      )}
    </div>
  )
}

// ── G-code Preview Panel ────────────────────────────────────────────────────

function GCodePreviewPanel({
  gcode,
  machinedLayers,
  jobName,
}: {
  gcode: string
  machinedLayers: number[]
  jobName: string
}) {
  const lines = useMemo(() => gcode.split('\n'), [gcode])

  const stats = useMemo(() => {
    const moves = lines.filter(l => /^G0[01]\s/i.test(l)).length
    const spindleStarts = lines.filter(l => /^M0?3\b/i.test(l)).length
    return { totalLines: lines.length, moves, spindleStarts }
  }, [lines])

  const colorLine = (line: string): React.ReactNode => {
    const trimmed = line.trimEnd()
    if (!trimmed) return <span>&nbsp;</span>

    // Comment lines
    if (trimmed.startsWith(';')) {
      return <span className="text-gray-500 italic">{trimmed}</span>
    }

    // Mixed: split command from inline comment
    const commentIdx = trimmed.indexOf(';')
    const cmd = commentIdx >= 0 ? trimmed.slice(0, commentIdx).trimEnd() : trimmed
    const comment = commentIdx >= 0 ? trimmed.slice(commentIdx) : ''

    if (!cmd) return <span className="text-gray-500 italic">{trimmed}</span>

    // Tokenise the command part
    const tokens = cmd.split(/\s+/)
    const colored = tokens.map((token, i) => {
      const upper = token.toUpperCase()
      if (/^G0[01]$/.test(upper))  return <span key={i} className="text-cyan-400">{token} </span>
      if (/^G0[23]$/.test(upper))  return <span key={i} className="text-cyan-300">{token} </span>
      if (/^G\d+$/.test(upper))    return <span key={i} className="text-cyan-500">{token} </span>
      if (/^M0?3$/.test(upper))    return <span key={i} className="text-green-400">{token} </span>
      if (/^M0?5$/.test(upper))    return <span key={i} className="text-red-400">{token} </span>
      if (/^M\d+$/.test(upper))    return <span key={i} className="text-purple-400">{token} </span>
      if (/^[XYZIJ]-?[\d.]+$/.test(upper)) return <span key={i} className="text-yellow-300">{token} </span>
      if (/^F[\d.]+$/.test(upper)) return <span key={i} className="text-orange-300">{token} </span>
      if (/^S[\d.]+$/.test(upper)) return <span key={i} className="text-green-300">{token} </span>
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
      {/* Stats bar */}
      <div className="grid grid-cols-4 gap-4">
        <StatCard label="Layers machined" value={machinedLayers.length} color="purple" />
        <StatCard label="Total G-code lines" value={stats.totalLines.toLocaleString()} color="blue" />
        <StatCard label="Move commands" value={stats.moves.toLocaleString()} color="cyan" />
        <StatCard label="Spindle starts" value={stats.spindleStarts} color="green" />
      </div>

      {/* G-code viewer */}
      <div className="bg-gray-950 border border-gray-800 rounded-xl overflow-hidden">
        <div className="flex items-center justify-between px-4 py-2 border-b border-gray-800 bg-gray-900">
          <span className="text-sm text-gray-400 font-mono">
            toolpath.gcode — {jobName}
          </span>
          <div className="flex gap-3 text-xs text-gray-600">
            <span><span className="text-cyan-400">■</span> G-code</span>
            <span><span className="text-yellow-300">■</span> Coords</span>
            <span><span className="text-green-400">■</span> Spindle on</span>
            <span><span className="text-red-400">■</span> Spindle off</span>
            <span><span className="text-orange-300">■</span> Feed</span>
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
                  <td className="px-4 py-px whitespace-pre">
                    {colorLine(line)}
                  </td>
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

function TabBtn({
  active,
  disabled,
  onClick,
  children,
}: {
  active: boolean
  disabled?: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={[
        'flex items-center gap-1 px-4 py-2 text-sm rounded-t-lg border-b-2 transition',
        active
          ? 'border-primary text-white'
          : 'border-transparent text-gray-500 hover:text-gray-300',
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
