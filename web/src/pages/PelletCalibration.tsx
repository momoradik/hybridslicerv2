import { useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { printProfilesApi } from '../api/client'
import type { PrintProfile } from '../types'

// ── G-code generation helpers ─────────────────────────────────────────────────

function calcE(b: number, h: number, len: number, dF: number, flowPct: number): number {
  return ((b * h * len) / ((Math.PI / 4) * dF * dF)) * (flowPct / 100)
}

function header(profile: PrintProfile): string {
  const nozzle = profile.nozzleDiameterMm > 0 ? profile.nozzleDiameterMm : 0.4
  const vDiam  = profile.pelletModeEnabled ? profile.virtualFilamentDiameterMm : 1.75
  return [
    '; ============================================================',
    '; HybridSlicer — Pellet Calibration G-code',
    `; Profile        : ${profile.name}`,
    `; Nozzle         : ${nozzle} mm`,
    `; Layer height   : ${profile.layerHeightMm} mm`,
    `; Virtual diam   : ${vDiam} mm (pellet mode: ${profile.pelletModeEnabled ? 'ON' : 'OFF'})`,
    `; Base flow      : ${profile.materialFlowPct} %`,
    '; ============================================================',
    '',
    `M104 S${profile.printTemperatureDegC}   ; set extruder temp`,
    `M140 S${profile.bedTemperatureDegC}     ; set bed temp`,
    `M109 S${profile.printTemperatureDegC}   ; wait for extruder`,
    `M190 S${profile.bedTemperatureDegC}     ; wait for bed`,
    'G28          ; home all',
    'G92 E0       ; reset extruder',
    'G90          ; absolute positioning',
    '',
  ].join('\n')
}

function footer(): string {
  return [
    '',
    'M104 S0     ; turn off extruder',
    'M140 S0     ; turn off bed',
    'G28 X0 Y0   ; home X Y',
    'M84         ; disable motors',
    '; ============================================================',
    '; End of calibration print',
    '; ============================================================',
  ].join('\n')
}

/** Generate flow-line calibration: N parallel 100 mm lines at different flow % */
function generateLineTest(profile: PrintProfile, flowSteps: number[]): string {
  const nozzle = profile.nozzleDiameterMm > 0 ? profile.nozzleDiameterMm : 0.4
  const dF     = profile.pelletModeEnabled ? profile.virtualFilamentDiameterMm : 1.75
  const h      = profile.layerHeightMm
  const b      = nozzle
  const speed  = profile.printSpeedMmS
  const startX = 10
  const lineLen = 100
  const yGap   = 6
  const z      = h

  const lines: string[] = [
    `; ── Flow Line Test ──`,
    `; Steps: ${flowSteps.join(', ')} %`,
    `; Line length: ${lineLen} mm`,
    `; Print each line, measure width with calipers, pick the flattest/closest to nozzle diameter`,
    '',
    `G0 Z${(z + 5).toFixed(2)} F3000   ; lift`,
  ]

  flowSteps.forEach((flowPct, i) => {
    const yStart = 20 + i * yGap
    const e = calcE(b, h, lineLen, dF, flowPct)

    lines.push(``)
    lines.push(`; --- Flow ${flowPct}% ---`)
    lines.push(`G0 X${startX.toFixed(1)} Y${yStart.toFixed(1)} Z${(z + 2).toFixed(2)} F5000`)
    lines.push(`G0 Z${z.toFixed(3)} F1000`)
    lines.push(`G92 E0`)
    lines.push(`G1 X${(startX + lineLen).toFixed(1)} Y${yStart.toFixed(1)} E${e.toFixed(4)} F${(speed * 60).toFixed(0)}`)
    // Label: small retract, move back, drop a comment
    lines.push(`G1 E${(e - 2).toFixed(4)} F${(45 * 60).toFixed(0)}   ; retract`)
    lines.push(`G0 Z${(z + 2).toFixed(2)} F3000`)
  })

  return lines.join('\n')
}

/** Generate a flow tower: single-wall 20×20 mm square, each 5 mm section at different flow % */
function generateFlowTower(profile: PrintProfile, flowSteps: number[]): string {
  const nozzle = profile.nozzleDiameterMm > 0 ? profile.nozzleDiameterMm : 0.4
  const dF     = profile.pelletModeEnabled ? profile.virtualFilamentDiameterMm : 1.75
  const h      = profile.layerHeightMm
  const b      = nozzle
  const speed  = profile.printSpeedMmS
  const sectionLayers = Math.max(1, Math.round(5 / h))  // 5 mm per section

  // Square perimeter 20×20 mm centered at (50,50)
  const cx = 50, cy = 50, side = 20
  const corners = [
    [cx - side/2, cy - side/2],
    [cx + side/2, cy - side/2],
    [cx + side/2, cy + side/2],
    [cx - side/2, cy + side/2],
  ]

  const lines: string[] = [
    `; ── Flow Tower ──`,
    `; ${sectionLayers} layers per section (${h} mm each = 5 mm/section)`,
    `; Flow steps: ${flowSteps.join(', ')} %`,
    `; Square perimeter 20×20 mm`,
    '',
  ]

  let layerNum = 0
  flowSteps.forEach(flowPct => {
    lines.push(``)
    lines.push(`; === Flow ${flowPct}% section ===`)
    for (let s = 0; s < sectionLayers; s++) {
      layerNum++
      const z = layerNum * h
      const ePerSide = calcE(b, h, side, dF, flowPct)
      lines.push(`; Layer ${layerNum} — z=${z.toFixed(3)}`)
      lines.push(`G0 Z${z.toFixed(3)} F3000`)
      lines.push(`G0 X${corners[0][0].toFixed(1)} Y${corners[0][1].toFixed(1)} F5000`)
      lines.push(`G92 E0`)
      let eCum = 0
      for (let c = 0; c < 4; c++) {
        const next = corners[(c + 1) % 4]
        eCum += ePerSide
        lines.push(`G1 X${next[0].toFixed(1)} Y${next[1].toFixed(1)} E${eCum.toFixed(4)} F${(speed * 60).toFixed(0)}`)
      }
      lines.push(`G1 E${(eCum - 2).toFixed(4)} F${(45*60).toFixed(0)}   ; retract`)
    }
    const sectionHeight = sectionLayers * h
    lines.push(`; ↑ Measure wall width here (should be ≈${nozzle} mm for flow ${flowPct}%)`)
    lines.push(`; Section height: ${sectionHeight.toFixed(2)} mm`)
  })

  return [
    `; Total tower height: ${layerNum * h} mm (${flowSteps.length} sections × ${sectionLayers * h} mm)`,
    ...lines,
  ].join('\n')
}

/** Small 20×20×10 mm solid cube — single-shell — at the profile's default settings */
function generateCubeTest(profile: PrintProfile): string {
  const nozzle = profile.nozzleDiameterMm > 0 ? profile.nozzleDiameterMm : 0.4
  const dF     = profile.pelletModeEnabled ? profile.virtualFilamentDiameterMm : 1.75
  const h      = profile.layerHeightMm
  const b      = nozzle
  const speed  = profile.printSpeedMmS
  const totalLayers = Math.round(10 / h)
  const side = 20
  const cx = 50, cy = 50
  const corners = [
    [cx - side/2, cy - side/2],
    [cx + side/2, cy - side/2],
    [cx + side/2, cy + side/2],
    [cx - side/2, cy + side/2],
  ]
  const ePerSide = calcE(b, h, side, dF, profile.materialFlowPct)

  const lines: string[] = [
    `; ── Cube Test (20×20×10 mm, single wall) ──`,
    `; ${totalLayers} layers @ ${h} mm, flow=${profile.materialFlowPct}%`,
    `; Use calipers: wall thickness should be ≈ ${nozzle} mm`,
    '',
  ]

  for (let layer = 1; layer <= totalLayers; layer++) {
    const z = layer * h
    lines.push(`; Layer ${layer}`)
    lines.push(`G0 Z${z.toFixed(3)} F3000`)
    lines.push(`G0 X${corners[0][0].toFixed(1)} Y${corners[0][1].toFixed(1)} F5000`)
    lines.push(`G92 E0`)
    let eCum = 0
    for (let c = 0; c < 4; c++) {
      const next = corners[(c + 1) % 4]
      eCum += ePerSide
      lines.push(`G1 X${next[0].toFixed(1)} Y${next[1].toFixed(1)} E${eCum.toFixed(4)} F${(speed * 60).toFixed(0)}`)
    }
    lines.push(`G1 E${(eCum - 2).toFixed(4)} F${(45*60).toFixed(0)}   ; retract`)
  }

  return lines.join('\n')
}

function downloadGCode(filename: string, content: string) {
  const blob = new Blob([content], { type: 'text/plain' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

// ── Component ─────────────────────────────────────────────────────────────────

type FlowConfig = { min: number; max: number; step: number }

export default function PelletCalibration() {
  const { data: profiles = [] } = useQuery({
    queryKey: ['printProfiles'],
    queryFn: printProfilesApi.getAll,
  })

  const pelletProfiles = profiles.filter(p => p.pelletModeEnabled)
  const [selectedId, setSelectedId]   = useState<string>('')
  const [lineFlow, setLineFlow]       = useState<FlowConfig>({ min: 80, max: 120, step: 5 })
  const [towerFlow, setTowerFlow]     = useState<FlowConfig>({ min: 80, max: 120, step: 10 })

  const profile = useMemo(
    () => profiles.find(p => p.id === selectedId) ?? null,
    [profiles, selectedId],
  )

  const lineSteps  = useMemo(() => steps(lineFlow),  [lineFlow])
  const towerSteps = useMemo(() => steps(towerFlow), [towerFlow])

  function generate(type: 'line' | 'tower' | 'cube') {
    if (!profile) return
    const h = header(profile)
    const f = footer()
    let body = ''
    let name = ''
    if (type === 'line') {
      body = generateLineTest(profile, lineSteps)
      name = `${profile.name}_flow_line_test.gcode`
    } else if (type === 'tower') {
      body = generateFlowTower(profile, towerSteps)
      name = `${profile.name}_flow_tower.gcode`
    } else {
      body = generateCubeTest(profile)
      name = `${profile.name}_cube_test.gcode`
    }
    downloadGCode(name, h + '\n' + body + '\n' + f)
  }

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h2 className="text-2xl font-semibold text-white">Pellet Calibration</h2>
        <p className="text-sm text-gray-500 mt-1">
          Generate calibration G-code to dial in your pellet extruder's virtual filament diameter and flow rate.
        </p>
      </div>

      {/* Profile selector */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 space-y-3">
        <h3 className="font-medium text-white">Select Pellet Profile</h3>
        {pelletProfiles.length === 0 ? (
          <div className="text-sm text-amber-400 bg-amber-950/30 border border-amber-800/40 rounded-lg p-3">
            No profiles with Pellet Mode enabled. Go to{' '}
            <span className="font-medium text-amber-300">Print Settings</span> and enable Pellet Mode on a profile first.
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
                <p className="text-[11px] text-gray-500 mt-0.5">
                  Virtual diam: {p.virtualFilamentDiameterMm} mm &nbsp;·&nbsp;
                  Nozzle: {p.nozzleDiameterMm > 0 ? p.nozzleDiameterMm : 'machine'} mm &nbsp;·&nbsp;
                  LH: {p.layerHeightMm} mm
                </p>
              </button>
            ))}
          </div>
        )}
      </div>

      {profile && (
        <>
          {/* ── Tuning Guide ─────────────────────────────────────────────── */}
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 space-y-3">
            <h3 className="font-medium text-white">Tuning Workflow</h3>
            <ol className="space-y-2 text-sm text-gray-400 list-decimal list-inside">
              <li>
                <span className="text-gray-200 font-medium">Flow Line Test</span> — print lines at multiple flow
                percentages. Measure each with calipers.
                The line closest to your nozzle diameter ({profile.nozzleDiameterMm > 0 ? profile.nozzleDiameterMm : 'machine'} mm)
                is your base flow.
              </li>
              <li>
                <span className="text-gray-200 font-medium">Adjust Virtual Diameter</span> — if all lines are too
                wide, increase the virtual diameter; if too narrow, decrease it. Re-run line test until lines
                are consistent.
              </li>
              <li>
                <span className="text-gray-200 font-medium">Flow Tower</span> — confirms over a taller print.
                Look for even wall width and no over/under-extrusion bands.
              </li>
              <li>
                <span className="text-gray-200 font-medium">Cube Test</span> — final validation at default settings.
                Wall thickness should match the nozzle diameter and infill should be solid.
              </li>
            </ol>
            <div className="mt-2 bg-blue-950/30 border border-blue-800/40 rounded-lg p-3 text-xs text-blue-300/80">
              <p className="font-medium text-blue-300 mb-1">Current profile settings</p>
              <div className="grid grid-cols-3 gap-x-4 gap-y-1 font-mono">
                <span>virtual diam:</span><span className="text-white">{profile.virtualFilamentDiameterMm} mm</span><span />
                <span>nozzle:</span><span className="text-white">{profile.nozzleDiameterMm > 0 ? profile.nozzleDiameterMm : 'machine default'} mm</span><span />
                <span>layer height:</span><span className="text-white">{profile.layerHeightMm} mm</span><span />
                <span>base flow:</span><span className="text-white">{profile.materialFlowPct}%</span><span />
                <span>print speed:</span><span className="text-white">{profile.printSpeedMmS} mm/s</span><span />
                <span>temperature:</span><span className="text-white">{profile.printTemperatureDegC}°C</span><span />
              </div>
            </div>
          </div>

          {/* ── Test 1: Line Test ─────────────────────────────────────────── */}
          <TestCard
            title="1 — Flow Line Test"
            description="Prints parallel 100 mm lines at different flow percentages. Measure each with calipers."
            color="amber"
          >
            <div className="grid grid-cols-3 gap-3">
              <LabeledInput label="Min flow (%)" value={lineFlow.min} min={50} max={200}
                onChange={v => setLineFlow(f => ({ ...f, min: v }))} />
              <LabeledInput label="Max flow (%)" value={lineFlow.max} min={50} max={200}
                onChange={v => setLineFlow(f => ({ ...f, max: v }))} />
              <LabeledInput label="Step (%)" value={lineFlow.step} min={1} max={20}
                onChange={v => setLineFlow(f => ({ ...f, step: v }))} />
            </div>
            <p className="text-xs text-gray-500 mt-2">
              Steps: {lineSteps.join(', ')}% &nbsp;({lineSteps.length} lines)
            </p>
            <button
              onClick={() => generate('line')}
              className="mt-3 px-4 py-2 bg-amber-700 hover:bg-amber-600 text-white rounded-lg text-sm transition"
            >
              Download Line Test G-code
            </button>
          </TestCard>

          {/* ── Test 2: Flow Tower ───────────────────────────────────────── */}
          <TestCard
            title="2 — Flow Tower"
            description="Single-wall 20×20 mm tower. Each 5 mm section uses a different flow %. Look for consistent wall width."
            color="blue"
          >
            <div className="grid grid-cols-3 gap-3">
              <LabeledInput label="Min flow (%)" value={towerFlow.min} min={50} max={200}
                onChange={v => setTowerFlow(f => ({ ...f, min: v }))} />
              <LabeledInput label="Max flow (%)" value={towerFlow.max} min={50} max={200}
                onChange={v => setTowerFlow(f => ({ ...f, max: v }))} />
              <LabeledInput label="Step (%)" value={towerFlow.step} min={1} max={30}
                onChange={v => setTowerFlow(f => ({ ...f, step: v }))} />
            </div>
            <p className="text-xs text-gray-500 mt-2">
              Steps: {towerSteps.join(', ')}% &nbsp;({towerSteps.length} sections ×{' '}
              {(Math.round(5 / profile.layerHeightMm) * profile.layerHeightMm).toFixed(2)} mm ≈{' '}
              {(towerSteps.length * 5).toFixed(0)} mm total height)
            </p>
            <button
              onClick={() => generate('tower')}
              className="mt-3 px-4 py-2 bg-blue-700 hover:bg-blue-600 text-white rounded-lg text-sm transition"
            >
              Download Flow Tower G-code
            </button>
          </TestCard>

          {/* ── Test 3: Cube Test ─────────────────────────────────────────── */}
          <TestCard
            title="3 — Cube Validation Test"
            description="20×20×10 mm single-wall cube at your default settings. Final check before production prints."
            color="green"
          >
            <p className="text-xs text-gray-500">
              Uses profile defaults: flow={profile.materialFlowPct}%, speed={profile.printSpeedMmS} mm/s,{' '}
              {Math.round(10 / profile.layerHeightMm)} layers.
            </p>
            <button
              onClick={() => generate('cube')}
              className="mt-3 px-4 py-2 bg-green-700 hover:bg-green-600 text-white rounded-lg text-sm transition"
            >
              Download Cube Test G-code
            </button>
          </TestCard>
        </>
      )}
    </div>
  )
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function steps({ min, max, step }: FlowConfig): number[] {
  const result: number[] = []
  for (let v = min; v <= max + 0.001; v += step)
    result.push(Math.round(v))
  return result
}

function TestCard({
  title, description, color, children,
}: {
  title: string
  description: string
  color: 'amber' | 'blue' | 'green'
  children: React.ReactNode
}) {
  const border: Record<string, string> = {
    amber: 'border-amber-800/50',
    blue:  'border-blue-800/50',
    green: 'border-green-800/50',
  }
  const heading: Record<string, string> = {
    amber: 'text-amber-300',
    blue:  'text-blue-300',
    green: 'text-green-300',
  }
  return (
    <div className={`bg-gray-900 border rounded-xl p-5 space-y-3 ${border[color]}`}>
      <h3 className={`font-medium ${heading[color]}`}>{title}</h3>
      <p className="text-sm text-gray-400">{description}</p>
      {children}
    </div>
  )
}

function LabeledInput({
  label, value, min, max, onChange,
}: {
  label: string; value: number; min?: number; max?: number
  onChange: (v: number) => void
}) {
  return (
    <div className="space-y-1">
      <label className="text-xs text-gray-500">{label}</label>
      <input
        type="number" min={min} max={max} value={value}
        onChange={e => onChange(+e.target.value)}
        className="input w-full text-sm"
      />
    </div>
  )
}
