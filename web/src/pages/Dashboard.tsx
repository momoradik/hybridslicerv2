import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { jobsApi } from '../api/client'
import type { JobStatus } from '../types'

const STATUS_COLOR: Record<JobStatus, string> = {
  Draft:               'bg-gray-700 text-gray-300',
  StlImported:         'bg-blue-900 text-blue-300',
  Slicing:             'bg-yellow-900 text-yellow-300 animate-pulse',
  SlicingComplete:     'bg-blue-800 text-blue-200',
  GeneratingToolpaths: 'bg-purple-900 text-purple-300 animate-pulse',
  ToolpathsComplete:   'bg-purple-800 text-purple-200',
  PlanningHybrid:      'bg-orange-900 text-orange-300 animate-pulse',
  Ready:               'bg-green-900 text-green-300',
  Running:             'bg-green-700 text-green-100 animate-pulse',
  Paused:              'bg-yellow-800 text-yellow-200',
  Complete:            'bg-green-950 text-green-400',
  Failed:              'bg-red-950 text-red-400',
}

export default function Dashboard() {
  const qc = useQueryClient()
  const { data: jobs = [], isLoading } = useQuery({
    queryKey: ['jobs'],
    queryFn: jobsApi.getAll,
    refetchInterval: 3000,
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => jobsApi.deleteJob(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['jobs'] }),
  })

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-semibold text-white">Dashboard</h2>
        <Link
          to="/import"
          className="px-4 py-2 bg-primary/80 hover:bg-primary text-white text-sm rounded-lg transition-colors"
        >
          + New Job
        </Link>
      </div>

      {isLoading ? (
        <p className="text-gray-500">Loading jobs…</p>
      ) : jobs.length === 0 ? (
        <div className="text-center py-20 text-gray-600">
          <p className="text-4xl mb-4">📦</p>
          <p>No jobs yet. Import an STL to get started.</p>
        </div>
      ) : (
        <div className="grid gap-4">
          {jobs.map(job => (
            <div key={job.id} className="bg-gray-900 border border-gray-800 rounded-xl p-4 flex items-center justify-between">
              <div className="min-w-0 flex-1">
                <p className="font-medium text-white truncate">{job.name}</p>
                <p className="text-xs text-gray-500 mt-0.5">
                  {new Date(job.createdAt).toLocaleString()}
                  {job.totalPrintLayers !== undefined && ` · ${job.totalPrintLayers} layers`}
                </p>
                {job.errorMessage && (
                  <p className="text-xs text-red-400 mt-0.5 truncate">{job.errorMessage}</p>
                )}
              </div>
              <div className="flex items-center gap-3 flex-shrink-0 ml-4">
                <span className={`px-2.5 py-1 rounded-full text-xs font-medium ${STATUS_COLOR[job.status]}`}>
                  {job.status}
                </span>
                <button
                  onClick={() => {
                    if (confirm(`Delete "${job.name}"?\n\nThis will permanently remove the job and all generated files (STL, G-code).`))
                      deleteMutation.mutate(job.id)
                  }}
                  disabled={deleteMutation.isPending}
                  className="px-2.5 py-1 rounded-lg text-xs bg-gray-800 hover:bg-red-900/60 border border-gray-700 hover:border-red-700 text-gray-400 hover:text-red-300 transition disabled:opacity-40"
                  title="Delete job and all generated files"
                >
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
