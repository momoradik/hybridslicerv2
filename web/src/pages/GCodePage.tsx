import { useParams, Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { jobsApi } from '../api/client'

export default function GCodePage() {
  const { id } = useParams<{ id: string }>()

  const { data: gcode, isLoading, isError } = useQuery({
    queryKey: ['print-gcode', id],
    queryFn: () => jobsApi.getPrintGCode(id!),
    enabled: !!id,
  })

  return (
    <div className="flex flex-col gap-4 h-[calc(100vh-8rem)]">
      <div className="flex items-center gap-4 flex-shrink-0">
        <Link to="/import" className="text-xs px-3 py-1.5 rounded-lg bg-gray-800 hover:bg-gray-700
                                      text-gray-400 hover:text-gray-200 border border-gray-700 transition">
          ← Back
        </Link>
        <h2 className="text-xl font-semibold text-white">G-code Preview</h2>
        {gcode && (
          <span className="text-xs text-gray-500">
            {gcode.split('\n').length.toLocaleString()} lines
          </span>
        )}
      </div>

      {isLoading && <p className="text-gray-400">Loading G-code…</p>}
      {isError && <p className="text-red-400">Failed to load G-code.</p>}
      {gcode && (
        <pre className="flex-1 min-h-0 overflow-auto bg-gray-950 text-green-400 text-xs p-4 rounded-xl font-mono leading-relaxed">
          {gcode}
        </pre>
      )}
    </div>
  )
}
