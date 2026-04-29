import { useState, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { customGCodeApi, machineProfilesApi, jobsApi } from '../api/client'
import DisabledHint from '../components/DisabledHint'
import type { CustomGCodeBlock, GCodeTrigger, PrintJob } from '../types'

const BASE_TRIGGERS: { value: GCodeTrigger; label: string }[] = [
  { value: 'JobStart',         label: 'Job Start' },
  { value: 'JobEnd',           label: 'Job End' },
  { value: 'BeforePrinting',   label: 'Before Printing' },
  { value: 'AfterPrinting',    label: 'After Printing' },
  { value: 'BeforeMachining',  label: 'Before Machining' },
  { value: 'AfterMachining',   label: 'After Machining' },
]

function buildExtruderTriggers(extruderCount: number): { value: GCodeTrigger; label: string }[] {
  const result: { value: GCodeTrigger; label: string }[] = []
  for (let i = 0; i < Math.min(extruderCount, 8); i++) {
    result.push({ value: `BeforeExtruder${i}` as GCodeTrigger, label: `Before Extruder ${i + 1}` })
    result.push({ value: `AfterExtruder${i}` as GCodeTrigger, label: `After Extruder ${i + 1}` })
  }
  return result
}

type Tab = 'blocks' | 'jobs'

export default function CustomGCode() {
  const qc = useQueryClient()
  const { data: blocks = [] } = useQuery({ queryKey: ['gcode-blocks'], queryFn: customGCodeApi.getAll })
  const { data: machines = [] } = useQuery({ queryKey: ['machines'], queryFn: machineProfilesApi.getAll })
  const { data: jobs = [] } = useQuery({ queryKey: ['jobs'], queryFn: jobsApi.getAll })

  const [activeTab, setActiveTab] = useState<Tab>('blocks')
  const [editing, setEditing] = useState<Partial<CustomGCodeBlock> | null>(null)
  const [selectedMachineId, setSelectedMachineId] = useState('')

  // Job customisation state
  const [selectedJobId, setSelectedJobId] = useState('')
  const [jobGCode, setJobGCode] = useState('')
  const [jobTrigger, setJobTrigger] = useState<GCodeTrigger>('JobStart')
  const [jobBlockName, setJobBlockName] = useState('')

  const selectedMachine = machines.find(m => m.id === selectedMachineId)
  const maxExtruders = selectedMachine?.extruderCount ?? Math.max(...machines.map(m => m.extruderCount), 1)

  const allTriggers = useMemo(() => {
    const ext = buildExtruderTriggers(maxExtruders)
    return [...BASE_TRIGGERS, ...ext]
  }, [maxExtruders])

  const triggerLabel = (t: GCodeTrigger) => allTriggers.find(tr => tr.value === t)?.label ?? t

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

  // Job-level G-code: create a block tagged for a specific job
  const jobCreateMutation = useMutation({
    mutationFn: customGCodeApi.create,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['gcode-blocks'] })
      setJobGCode(''); setJobBlockName('')
    },
  })

  const handleJobBlockSave = () => {
    if (!selectedJobId || !jobBlockName.trim() || !jobGCode.trim()) return
    jobCreateMutation.mutate({
      name: `[Job] ${jobBlockName}`,
      gCodeContent: jobGCode,
      trigger: jobTrigger,
      isEnabled: true,
      sortOrder: 0,
      description: `Job-specific: ${selectedJobId}`,
    })
  }

  const completedJobs = jobs.filter((j: PrintJob) =>
    ['SlicingComplete', 'ToolpathsComplete', 'Ready'].includes(j.status))

  // Blocks that match the selected job (tagged in description)
  const jobBlocks = blocks.filter(b => b.description?.includes(selectedJobId) && selectedJobId)

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-semibold text-white">G-code Customisation</h2>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-gray-800">
        <TabBtn active={activeTab === 'blocks'} onClick={() => setActiveTab('blocks')}>Global Blocks</TabBtn>
        <TabBtn active={activeTab === 'jobs'} onClick={() => setActiveTab('jobs')}>Job Customisation</TabBtn>
      </div>

      {activeTab === 'blocks' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <span className="text-sm text-gray-400">Machine context:</span>
              <select className="input text-sm py-1" value={selectedMachineId}
                onChange={e => setSelectedMachineId(e.target.value)}>
                <option value="">All extruders (max across machines)</option>
                {machines.map(m => (
                  <option key={m.id} value={m.id}>{m.name} ({m.extruderCount} extruder{m.extruderCount > 1 ? 's' : ''})</option>
                ))}
              </select>
            </div>
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
                    <span className="px-2 py-0.5 bg-gray-800 text-gray-400 text-xs rounded-full">{triggerLabel(block.trigger)}</span>
                    {block.description && (
                      <span className="px-2 py-0.5 bg-blue-900/40 text-blue-400 text-xs rounded-full">{block.description.startsWith('Job-specific') ? 'Job' : ''}</span>
                    )}
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
            {blocks.length === 0 && (
              <p className="text-gray-500 text-sm text-center py-8">No G-code customisation blocks. Click "+ New Block" to create one.</p>
            )}
          </div>
        </div>
      )}

      {activeTab === 'jobs' && (
        <div className="space-y-4">
          <p className="text-sm text-gray-400">
            Attach G-code customisation blocks to a specific job. These are included in the hybrid output when the job is planned.
          </p>

          <div className="grid grid-cols-2 gap-6">
            {/* Left: create/edit */}
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 space-y-4">
              <h3 className="text-sm font-semibold text-white">Add Job G-code</h3>

              <div className="space-y-1">
                <label className="text-xs text-gray-400">Job</label>
                <select className="input w-full" value={selectedJobId} onChange={e => setSelectedJobId(e.target.value)}>
                  <option value="">Select a job…</option>
                  {completedJobs.map((j: PrintJob) => (
                    <option key={j.id} value={j.id}>{j.name} ({j.status})</option>
                  ))}
                </select>
              </div>

              <div className="space-y-1">
                <label className="text-xs text-gray-400">Block Name</label>
                <input className="input w-full" value={jobBlockName}
                  onChange={e => setJobBlockName(e.target.value)} placeholder="e.g. Custom homing" />
              </div>

              <div className="space-y-1">
                <label className="text-xs text-gray-400">Trigger</label>
                <select className="input w-full" value={jobTrigger}
                  onChange={e => setJobTrigger(e.target.value as GCodeTrigger)}>
                  {allTriggers.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                </select>
              </div>

              <div className="space-y-1">
                <label className="text-xs text-gray-400">G-code</label>
                <textarea
                  className="input w-full font-mono text-xs h-32 resize-none"
                  placeholder="; Enter G-code here"
                  value={jobGCode}
                  onChange={e => setJobGCode(e.target.value)}
                />
              </div>

              <DisabledHint when={!selectedJobId || !jobBlockName.trim() || !jobGCode.trim()} reason={
                !selectedJobId ? 'Select a job first.' :
                !jobBlockName.trim() ? 'Enter a block name.' :
                'Enter G-code content.'
              }>
                <button onClick={handleJobBlockSave}
                  disabled={!selectedJobId || !jobBlockName.trim() || !jobGCode.trim() || jobCreateMutation.isPending}
                  className="w-full py-2 bg-primary/80 hover:bg-primary disabled:opacity-40 text-white rounded-lg text-sm">
                  {jobCreateMutation.isPending ? 'Saving…' : 'Save Job Block'}
                </button>
              </DisabledHint>
            </div>

            {/* Right: existing blocks for this job */}
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 space-y-3">
              <h3 className="text-sm font-semibold text-white">
                Blocks for {completedJobs.find((j: PrintJob) => j.id === selectedJobId)?.name ?? 'selected job'}
              </h3>
              {selectedJobId ? (
                jobBlocks.length > 0 ? (
                  <div className="space-y-2">
                    {jobBlocks.map(b => (
                      <div key={b.id} className="bg-gray-950 border border-gray-800 rounded-lg p-3 flex items-start gap-3">
                        <label className="flex items-center mt-0.5 cursor-pointer">
                          <input type="checkbox" checked={b.isEnabled}
                            onChange={e => toggleMutation.mutate({ id: b.id, enabled: e.target.checked })}
                            className="w-3.5 h-3.5 accent-primary" />
                        </label>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-sm text-white">{b.name}</span>
                            <span className="px-1.5 py-0.5 bg-gray-800 text-gray-500 text-[10px] rounded">{triggerLabel(b.trigger)}</span>
                          </div>
                          <pre className="mt-1 text-[10px] text-gray-600 font-mono max-h-12 overflow-hidden">{b.gCodeContent}</pre>
                        </div>
                        <button onClick={() => deleteMutation.mutate(b.id)}
                          className="text-red-500 hover:text-red-400 text-xs shrink-0">Del</button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-gray-600 text-xs py-4 text-center">No custom blocks for this job yet.</p>
                )
              ) : (
                <p className="text-gray-600 text-xs py-4 text-center">Select a job to see its custom blocks.</p>
              )}
            </div>
          </div>
        </div>
      )}

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
              {allTriggers.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
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

function TabBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick}
      className={`px-5 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${
        active ? 'border-primary text-white' : 'border-transparent text-gray-500 hover:text-gray-300'
      }`}>
      {children}
    </button>
  )
}
