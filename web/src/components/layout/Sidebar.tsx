import { NavLink } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { brandingApi } from '../../api/client'

const navItems = [
  { to: '/dashboard',       label: 'Dashboard',        icon: '⬛' },
  { to: '/import',          label: 'Import STL',        icon: '📁' },
  { to: '/print-settings',  label: 'Print Settings',    icon: '🖨️' },
  { to: '/machine-config',  label: 'Machine Config',    icon: '⚙️' },
  { to: '/tools',           label: 'Tool Library',      icon: '🔧' },
  { to: '/hybrid-planner',  label: 'Hybrid Planner',    icon: '🔀' },
  { to: '/custom-gcode',    label: 'Custom G-code',     icon: '📝' },
  { to: '/calibration',     label: 'Calibration',       icon: '📐' },
  { to: '/settings/branding', label: 'Branding',        icon: '🎨' },
]

export default function Sidebar() {
  const { data: branding } = useQuery({
    queryKey: ['branding'],
    queryFn: brandingApi.get,
    staleTime: Infinity,
  })

  return (
    <nav className="w-56 bg-gray-900 border-r border-gray-800 flex flex-col shrink-0">
      <div className="px-4 py-5 border-b border-gray-800">
        <h1 className="text-lg font-bold text-primary-400 truncate">
          {branding?.appTitle ?? 'HybridSlicer'}
        </h1>
        {branding?.companyName && (
          <p className="text-xs text-gray-500 mt-0.5">{branding.companyName}</p>
        )}
      </div>

      <ul className="flex-1 py-3 space-y-0.5 overflow-y-auto">
        {navItems.map(({ to, label, icon }) => (
          <li key={to}>
            <NavLink
              to={to}
              className={({ isActive }) =>
                `flex items-center gap-3 px-4 py-2.5 text-sm transition-colors rounded-md mx-2 ` +
                (isActive
                  ? 'bg-primary/20 text-primary-300 font-medium'
                  : 'text-gray-400 hover:text-gray-200 hover:bg-gray-800')
              }
            >
              <span>{icon}</span>
              {label}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  )
}
