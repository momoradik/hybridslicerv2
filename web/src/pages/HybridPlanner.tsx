import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { jobsApi, toolsApi } from '../api/client'

export default function HybridPlanner() {
  const qc = useQueryClient()
  const { data: jobs = [] } = useQuery({ queryKey: ['jobs'], queryFn: jobsApi.getAll })
  const { data: tools = [] } = useQuery({ queryKey: ['tools'], queryFn: toolsApi.getAll })

  const [jobId, setJobId] = useState('')
  const [toolId, setToolId] = useState('')
  const [machineEveryN, setMachineEveryN] = useState(10)

  const readyJobs = jobs.filter(j => j.status === 'SlicingComplete' || j.status === 'ToolpathsComplete')

  const toolpathsMutation = useMutation({
    mutationFn: () => jobsApi.generateToolpaths(jobId, toolId, machineEveryN),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['jobs'] }),
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

  const selectedJob = jobs.find(j => j.id === jobId)

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-semibold text-white">Hybrid Process Planner</h2>

      <div className="grid grid-cols-2 gap-6">
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-6 space-y-5">
          <h3 className="font-medium text-white">Configuration</h3>

          <Field label="Job (must be sliced)">
            <select className="input" value={jobId} onChange={e => setJobId(e.target.value)}>
              <option value="">Select…</option>
              {readyJobs.map(j => <option key={j.id} value={j.id}>{j.name} ({j.status})</option>)}
            </select>
          </Field>

          <Field label="CNC Tool">
            <select className="input" value={toolId} onChange={e => setToolId(e.target.value)}>
              <option value="">Select…</option>
              {tools.map(t => <option key={t.id} value={t.id}>{t.name} (Ø{t.diameterMm} mm)</option>)}
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
        </div>

        {/* Process plan visualizer */}
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-6">
          <h3 className="font-medium text-white mb-4">Process Preview</h3>
          {selectedJob ? (
            <div className="space-y-1 text-sm font-mono text-gray-400">
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
    </div>
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
