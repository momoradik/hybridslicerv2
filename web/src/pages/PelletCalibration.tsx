import { useState, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { printProfilesApi } from '../api/client'
import type { PrintProfile } from '../types'

// ── G-code generation helpers ─────────────────────────────────────────────────

const RETRACT_MM   = 2     // mm retract after each line / perimeter
const RETRACT_FMPM = 2700  // retract feed rate mm/min (45 mm/s)

function calcE(b: number, h: number, len: number, dF: number, flowPct: number): number {
  return ((b * h * len) / ((Math.PI / 4) * dF * dF)) * (flowPct / 100)
}

function effectiveDiam(p: PrintProfile): number {
  return p.pelletModeEnabled ? p.virtualFilamentDiameterMm : 1.75
}

function effectiveNozzle(p: PrintProfile): number {
  return p.nozzleDiameterMm > 0 ? p.nozzleDiameterMm : 0.4
}

/** Shared startup G-code: heat, home, prime line */
function gcodeHeader(profile: PrintProfile): string {
  const nozzle = effectiveNozzle(profile)
  const dF     = effectiveDiam(profile)
  const h      = profile.layerHeightMm
  // Prime line: 60 mm along X=10–70, Y=5
  const primeE = calcE(nozzle, h, 60, dF, profile.materialFlowPct)

  return [
    '; ============================================================',
    '; HybridSlicer — Pellet Calibration G-code',
    `; Profile        : ${profile.name}`,
    `; Nozzle         : ${nozzle} mm`,
    `; Layer height   : ${profile.layerHeightMm} mm`,
    `; Virtual diam   : ${dF} mm  (pellet mode: ${profile.pelletModeEnabled ? 'ON' : 'OFF'})`,
    `; Base flow      : ${profile.materialFlowPct} %`,
    '; ============================================================',
    '',
    `M104 S${profile.printTemperatureDegC}   ; set extruder temp (no wait)`,
    `M140 S${profile.bedTemperatureDegC}     ; set bed temp (no wait)`,
    `M109 S${profile.printTemperatureDegC}   ; wait for extruder`,
    `M190 S${profile.bedTemperatureDegC}     ; wait for bed`,
    'G28          ; home all axes',
    'G92 E0       ; reset extruder position',
    'G90          ; absolute XYZ positioning',
    'M82          ; absolute extrusion mode',
    '',
    '; --- Prime line ---',
    `G0 Z${(h * 3).toFixed(2)} F3000`,
    'G0 X10.0 Y5.0 F5000',
    `G0 Z${h.toFixed(3)} F1000`,
    'G92 E0',
    `G1 X70.0 Y5.0 E${primeE.toFixed(4)} F${(profile.printSpeedMmS * 60).toFixed(0)}`,
    `G1 E${(primeE - RETRACT_MM).toFixed(4)} F${RETRACT_FMPM}   ; retract`,
    `G0 Z${(h * 3).toFixed(2)} F3000`,
    '',
  ].join('\n')
}

function gcodeFooter(): string {
  return [
    '',
    '; --- End ---',
    'M104 S0     ; turn off extruder',
    'M140 S0     ; turn off bed',
    'G28 X0 Y0   ; home X Y',
    'M84         ; disable motors',
    '; ============================================================',
    '; End of calibration print',
    '; ============================================================',
  ].join('\n')
}

/** Flow line test: parallel 100 mm lines at different flow % values */
function generateLineTest(profile: PrintProfile, flowSteps: number[]): string {
  const nozzle  = effectiveNozzle(profile)
  const dF      = effectiveDiam(profile)
  const h       = profile.layerHeightMm
  const speed   = profile.printSpeedMmS
  const startX  = 10
  const lineLen = 100
  const yGap    = 8         // mm between lines
  const yStart0 = 20        // first line Y position
  const z       = h

  const out: string[] = [
    '; ── Flow Line Test ──',
    `; Lines: ${flowSteps.join(', ')} %`,
    `; Length: ${lineLen} mm each, spaced ${yGap} mm apart`,
    `; Measure wall width with calipers after printing.`,
    `; The line closest to ${nozzle} mm wide is your best flow %.`,
    '',
    `G0 Z${(z + 5).toFixed(2)} F3000`,
  ]

  flowSteps.forEach((flowPct, i) => {
    const y = yStart0 + i * yGap
    const e = calcE(nozzle, h, lineLen, dF, flowPct)
    // Safe retract: never go below 0
    const eRetract = Math.max(0, e - RETRACT_MM)

    out.push('')
    out.push(`; --- Flow ${flowPct}% ---`)
    out.push(`G0 X${startX.toFixed(1)} Y${y.toFixed(1)} F5000`)
    out.push(`G0 Z${z.toFixed(3)} F1000`)
    out.push('G92 E0')
    out.push(`G1 X${(startX + lineLen).toFixed(1)} Y${y.toFixed(1)} E${e.toFixed(4)} F${(speed * 60).toFixed(0)}`)
    out.push(`G1 E${eRetract.toFixed(4)} F${RETRACT_FMPM}   ; retract`)
    out.push(`G0 Z${(z + 2).toFixed(2)} F3000`)
  })

  return out.join('\n')
}

/** Flow tower: single-wall 20×20 mm square, 5 mm sections at different flow % */
function generateFlowTower(profile: PrintProfile, flowSteps: number[]): string {
  const nozzle        = effectiveNozzle(profile)
  const dF            = effectiveDiam(profile)
  const h             = profile.layerHeightMm
  const speed         = profile.printSpeedMmS
  const sectionLayers = Math.max(1, Math.round(5 / h))
  const side          = 20
  const cx = 50, cy = 50
  const corners = [
    [cx - side / 2, cy - side / 2],
    [cx + side / 2, cy - side / 2],
    [cx + side / 2, cy + side / 2],
    [cx - side / 2, cy + side / 2],
  ]

  const out: string[] = [
    `; Total tower height: ${(flowSteps.length * sectionLayers * h).toFixed(2)} mm`,
    `; (${flowSteps.length} sections × ${sectionLayers} layers × ${h} mm)`,
    '; ── Flow Tower ──',
    `; Sections: ${flowSteps.join(', ')} %`,
    '; Square perimeter 20×20 mm centered at (50,50)',
    '',
  ]

  let layerNum = 0
  flowSteps.forEach(flowPct => {
    out.push('')
    out.push(`; === Flow ${flowPct}% section ===`)
    for (let s = 0; s < sectionLayers; s++) {
      layerNum++
      const z         = layerNum * h
      const ePerSide  = calcE(nozzle, h, side, dF, flowPct)
      let eCum        = 0

      out.push(`; Layer ${layerNum}  z=${z.toFixed(3)}`)
      out.push(`G0 Z${z.toFixed(3)} F3000`)
      out.push(`G0 X${corners[0][0].toFixed(1)} Y${corners[0][1].toFixed(1)} F5000`)
      out.push('G92 E0')
      for (let c = 0; c < 4; c++) {
        const next = corners[(c + 1) % 4]
        eCum += ePerSide
        out.push(`G1 X${next[0].toFixed(1)} Y${next[1].toFixed(1)} E${eCum.toFixed(4)} F${(speed * 60).toFixed(0)}`)
      }
      const eRetract = Math.max(0, eCum - RETRACT_MM)
      out.push(`G1 E${eRetract.toFixed(4)} F${RETRACT_FMPM}   ; retract`)
    }
    out.push(`; ↑ Measure wall width at this section (target ≈ ${nozzle} mm)`)
  })

  return out.join('\n')
}

/** 20×20×10 mm single-wall cube at profile defaults */
function generateCubeTest(profile: PrintProfile): string {
  const nozzle      = effectiveNozzle(profile)
  const dF          = effectiveDiam(profile)
  const h           = profile.layerHeightMm
  const speed       = profile.printSpeedMmS
  const totalLayers = Math.round(10 / h)
  const side        = 20
  const cx = 50, cy = 50
  const corners = [
    [cx - side / 2, cy - side / 2],
    [cx + side / 2, cy - side / 2],
    [cx + side / 2, cy + side / 2],
    [cx - side / 2, cy + side / 2],
  ]
  const ePerSide = calcE(nozzle, h, side, dF, profile.materialFlowPct)

  const out: string[] = [
    `; ── Cube Test (20×20×10 mm, single wall) ──`,
    `; ${totalLayers} layers @ ${h} mm, flow=${profile.materialFlowPct}%`,
    `; Wall thickness should be ≈ ${nozzle} mm after printing`,
    '',
  ]

  for (let layer = 1; layer <= totalLayers; layer++) {
    const z    = layer * h
    let eCum   = 0
    out.push(`; Layer ${layer}`)
    out.push(`G0 Z${z.toFixed(3)} F3000`)
    out.push(`G0 X${corners[0][0].toFixed(1)} Y${corners[0][1].toFixed(1)} F5000`)
    out.push('G92 E0')
    for (let c = 0; c < 4; c++) {
      const next = corners[(c + 1) % 4]
      eCum += ePerSide
      out.push(`G1 X${next[0].toFixed(1)} Y${next[1].toFixed(1)} E${eCum.toFixed(4)} F${(speed * 60).toFixed(0)}`)
    }
    const eRetract = Math.max(0, eCum - RETRACT_MM)
    out.push(`G1 E${eRetract.toFixed(4)} F${RETRACT_FMPM}   ; retract`)
  }

  return out.join('\n')
}

function downloadGCode(filename: string, content: string) {
  const blob = new Blob([content], { type: 'text/plain' })
  const url  = URL.createObjectURL(blob)
  const a    = Object.assign(document.createElement('a'), { href: url, download: filename })
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

// ── Component ─────────────────────────────────────────────────────────────────

type FlowConfig = { min: number; max: number; step: number }

function flowSteps({ min, max, step }: FlowConfig): number[] {
  const result: number[] = []
  for (let v = min; v <= max + 0.001; v += step)
    result.push(Math.round(v))
  return result
}

export default function PelletCalibration() {
  const { data: profiles = [], isLoading } = useQuery({
    queryKey: ['printProfiles'],
    queryFn:  printProfilesApi.getAll,
  })

  const pelletProfiles = profiles.filter(p => p.pelletModeEnabled)

  const [selectedId, setSelectedId] = useState<string>('')
  const [lineFlow,   setLineFlow]   = useState<FlowConfig>({ min: 80, max: 120, step: 5 })
  const [towerFlow,  setTowerFlow]  = useState<FlowConfig>({ min: 80, max: 120, step: 10 })

  const profile     = useMemo(() => profiles.find(p => p.id === selectedId) ?? null, [profiles, selectedId])
  const lineSteps   = useMemo(() => flowSteps(lineFlow),  [lineFlow])
  const towerSteps  = useMemo(() => flowSteps(towerFlow), [towerFlow])

  function generate(type: 'line' | 'tower' | 'cube') {
    if (!profile) return
    const head = gcodeHeader(profile)
    const foot = gcodeFooter()
    let body = '', name = ''
    if (type === 'line') {
      body = generateLineTest(profile, lineSteps)
      name = `${profile.name}_flow_lines.gcode`
    } else if (type === 'tower') {
      body = generateFlowTower(profile, towerSteps)
      name = `${profile.name}_flow_tower.gcode`
    } else {
      body = generateCubeTest(profile)
      name = `${profile.name}_cube_test.gcode`
    }
    downloadGCode(name, head + '\n' + body + '\n' + foot)
  }

  return (
    <div className="space-y-6 max-w-3xl">
      {/* Header */}
      <div>
        <h2 className="text-2xl font-semibold text-white">Pellet Calibration</h2>
        <p className="text-sm text-gray-500 mt-1">
          Generate calibration G-code to dial in your pellet extruder's virtual filament diameter and flow rate.
        </p>
      </div>

      {/* Profile selector */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 space-y-3">
        <h3 className="font-medium text-white">Select Pellet Profile</h3>

        {isLoading ? (
          <p className="text-sm text-gray-500">Loading profiles…</p>
        ) : pelletProfiles.length === 0 ? (
          <div className="text-sm text-amber-400 bg-amber-950/30 border border-amber-800/40 rounded-lg p-3 space-y-1">
            <p>No profiles with Pellet Mode enabled.</p>
            <p>
              Go to{' '}
              <Link to="/print-settings" className="underline text-amber-300 hover:text-amber-100">
                Print Settings
              </Link>{' '}
              and enable Pellet Mode on a profile first.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-2">
            {pelletProfiles.map(p => (
              <button
                key={p.id}
                onClick={() => setSelectedId(p.id)}
                className={`text-left p-3 rounded-lg border text-sm transition ${
                  selectedId === p.id
                    ? 'bg-amber-900/30 border-amber-700 text-amber-200'
                    : 'bg-gray-800 border-gray-700 text-gray-300 hover:border-gray-600'
                }`}
              >
                <p className="font-medium">{p.name}</p>
                <p className="text-[11px] text-gray-500 mt-0.5 space-x-2">
                  <span>vDiam: {p.virtualFilamentDiameterMm} mm</span>
                  <span>·</span>
                  <span>nozzle: {p.nozzleDiameterMm > 0 ? `${p.nozzleDiameterMm} mm` : 'machine'}</span>
                  <span>·</span>
                  <span>LH: {p.layerHeightMm} mm</span>
                </p>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* No profile selected hint */}
      {pelletProfiles.length > 0 && !profile && (
        <p className="text-sm text-gray-600 text-center py-4">
          Select a profile above to configure and download calibration prints.
        </p>
      )}

      {profile && (
        <>
          {/* ── Tuning Workflow Guide ──────────────────────────────────────── */}
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 space-y-4">
            <h3 className="font-medium text-white">Tuning Workflow</h3>

            <ol className="space-y-2.5 text-sm text-gray-400 list-decimal list-inside">
              <li>
                <span className="text-gray-200 font-medium">Flow Line Test</span> — print lines at multiple
                flow %, measure wall width with calipers. The line closest to your nozzle diameter (
                {effectiveNozzle(profile)} mm) is your best flow %.
              </li>
              <li>
                <span className="text-gray-200 font-medium">Adjust Virtual Diameter</span> — if all lines are
                consistently too wide, increase the virtual diameter; too narrow → decrease it. Update the
                profile in Print Settings, then re-run the line test.
              </li>
              <li>
                <span className="text-gray-200 font-medium">Flow Tower</span> — confirms consistency over height.
                Even wall width with no banding = good. Adjust flow % if one section looks better.
              </li>
              <li>
                <span className="text-gray-200 font-medium">Cube Validation</span> — final check at default
                settings. Wall thickness ≈ nozzle diameter, no gaps or over-extrusion.
              </li>
            </ol>

            {/* Profile summary */}
            <div className="bg-blue-950/30 border border-blue-800/40 rounded-lg p-3 text-xs text-blue-300/80">
              <p className="font-medium text-blue-300 mb-2">Active profile — {profile.name}</p>
              <div className="grid grid-cols-2 gap-x-8 gap-y-1 font-mono text-[11px]">
                <Row label="Virtual diam" value={`${profile.virtualFilamentDiameterMm} mm`} />
                <Row label="Nozzle"       value={`${effectiveNozzle(profile)} mm`} />
                <Row label="Layer height" value={`${profile.layerHeightMm} mm`} />
                <Row label="Base flow"    value={`${profile.materialFlowPct} %`} />
                <Row label="Print speed"  value={`${profile.printSpeedMmS} mm/s`} />
                <Row label="Temperature"  value={`${profile.printTemperatureDegC} °C`} />
              </div>
            </div>
          </div>

          {/* ── Test 1: Flow Lines ─────────────────────────────────────────── */}
          <TestCard title="1 — Flow Line Test" color="amber"
            description="Parallel 100 mm lines, one per flow %. Measure each width with calipers after printing."
          >
            <div className="grid grid-cols-3 gap-3">
              <NumField label="Min flow (%)" value={lineFlow.min}  min={40}  max={200} onChange={v => setLineFlow(f => ({ ...f, min: v }))} />
              <NumField label="Max flow (%)" value={lineFlow.max}  min={40}  max={200} onChange={v => setLineFlow(f => ({ ...f, max: v }))} />
              <NumField label="Step (%)"     value={lineFlow.step} min={1}   max={20}  onChange={v => setLineFlow(f => ({ ...f, step: v }))} />
            </div>
            <div className="flex items-center justify-between mt-1">
              <p className="text-xs text-gray-500">
                {lineSteps.length} lines: {lineSteps.join(', ')} %
              </p>
              <p className="text-xs text-gray-600">
                starts at Y=20, spaced 8 mm
              </p>
            </div>
            <button onClick={() => generate('line')}
              className="mt-2 px-4 py-2 bg-amber-700 hover:bg-amber-600 text-white rounded-lg text-sm transition w-full">
              Download Flow Line Test G-code
            </button>
          </TestCard>

          {/* ── Test 2: Flow Tower ────────────────────────────────────────── */}
          <TestCard title="2 — Flow Tower" color="blue"
            description="Single-wall 20×20 mm square tower. Each 5 mm section uses a different flow %. Look for the section with the most even wall width."
          >
            <div className="grid grid-cols-3 gap-3">
              <NumField label="Min flow (%)" value={towerFlow.min}  min={40}  max={200} onChange={v => setTowerFlow(f => ({ ...f, min: v }))} />
              <NumField label="Max flow (%)" value={towerFlow.max}  min={40}  max={200} onChange={v => setTowerFlow(f => ({ ...f, max: v }))} />
              <NumField label="Step (%)"     value={towerFlow.step} min={1}   max={30}  onChange={v => setTowerFlow(f => ({ ...f, step: v }))} />
            </div>
            <div className="flex items-center justify-between mt-1">
              <p className="text-xs text-gray-500">
                {towerSteps.length} sections: {towerSteps.join(', ')} %
              </p>
              <p className="text-xs text-gray-600">
                ≈{(towerSteps.length * 5).toFixed(0)} mm tall
              </p>
            </div>
            <button onClick={() => generate('tower')}
              className="mt-2 px-4 py-2 bg-blue-700 hover:bg-blue-600 text-white rounded-lg text-sm transition w-full">
              Download Flow Tower G-code
            </button>
          </TestCard>

          {/* ── Test 3: Cube ──────────────────────────────────────────────── */}
          <TestCard title="3 — Cube Validation" color="green"
            description="20×20×10 mm single-wall cube at your profile defaults. Measure wall thickness — should match nozzle diameter."
          >
            <div className="grid grid-cols-3 gap-x-6 gap-y-1 text-xs font-mono text-gray-500 mt-1">
              <Row label="Size"   value="20 × 20 × 10 mm" />
              <Row label="Layers" value={`${Math.round(10 / profile.layerHeightMm)} @ ${profile.layerHeightMm} mm`} />
              <Row label="Flow"   value={`${profile.materialFlowPct} %`} />
            </div>
            <button onClick={() => generate('cube')}
              className="mt-3 px-4 py-2 bg-green-700 hover:bg-green-600 text-white rounded-lg text-sm transition w-full">
              Download Cube Validation G-code
            </button>
          </TestCard>
        </>
      )}
    </div>
  )
}

// ── Sub-components ────────────────────────────────────────────────────────────

function TestCard({
  title, description, color, children,
}: {
  title: string; description: string
  color: 'amber' | 'blue' | 'green'
  children: React.ReactNode
}) {
  const borderCls = { amber: 'border-amber-800/50', blue: 'border-blue-800/50', green: 'border-green-800/50' }
  const titleCls  = { amber: 'text-amber-300', blue: 'text-blue-300', green: 'text-green-300' }
  return (
    <div className={`bg-gray-900 border rounded-xl p-5 space-y-3 ${borderCls[color]}`}>
      <h3 className={`font-medium ${titleCls[color]}`}>{title}</h3>
      <p className="text-sm text-gray-400">{description}</p>
      {children}
    </div>
  )
}

function NumField({
  label, value, min, max, onChange,
}: {
  label: string; value: number; min?: number; max?: number
  onChange: (v: number) => void
}) {
  return (
    <div className="space-y-1">
      <label className="text-xs text-gray-500">{label}</label>
      <input type="number" min={min} max={max} value={value}
        onChange={e => onChange(+e.target.value)}
        className="input w-full text-sm" />
    </div>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <>
      <span className="text-gray-500">{label}:</span>
      <span className="text-white col-span-1">{value}</span>
    </>
  )
}
