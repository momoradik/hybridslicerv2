import { useEffect, useRef, useState, useMemo } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import type { BuildVolume } from './StlViewer'

// ── Types ─────────────────────────────────────────────────────────────────────

interface UnmachinableRegion {
  zHeightMm: number
  reason: string
  bounds: { minX: number; minY: number; maxX: number; maxY: number }
}

interface Props {
  toolpathGCode: string
  printGCode: string
  buildVolume: BuildVolume
  toolDiameterMm?: number
  unmachinableRegions?: UnmachinableRegion[]
  className?: string
}

interface SimMove {
  tx0: number; ty0: number; tz0: number  // Three.js coords (from)
  tx1: number; ty1: number; tz1: number  // Three.js coords (to)
  isRapid: boolean
  durationSec: number
}

interface PrintSegment {
  x0: number; y0: number; z0: number
  x1: number; y1: number; z1: number
  isSupport: boolean
}

// ── Parse CNC G-code ──────────────────────────────────────────────────────────

function parseCncMoves(gcode: string): { moves: SimMove[]; estimatedMachiningSec: number } {
  const moves: SimMove[] = []
  let gx = 0, gy = 0, gz = 0
  let feed = 800
  let hasPos = false
  let totalTimeSec = 0
  const RAPID_SPEED = 6000  // mm/min for G0

  for (const raw of gcode.split('\n')) {
    const line = raw.split(';')[0].trim()
    if (!line) continue
    const up = line.toUpperCase()

    const fm = up.match(/F([\d.]+)/)
    if (fm) feed = parseFloat(fm[1])

    const isG0 = /^G0($|\s)/.test(up)
    const isG1 = /^G1($|\s)/.test(up)
    if (!isG0 && !isG1) continue

    const xm = up.match(/X([+-]?[\d.]+)/)
    const ym = up.match(/Y([+-]?[\d.]+)/)
    const zm = up.match(/Z([+-]?[\d.]+)/)

    const nx = xm ? parseFloat(xm[1]) : gx
    const ny = ym ? parseFloat(ym[1]) : gy
    const nz = zm ? parseFloat(zm[1]) : gz

    if (hasPos) {
      const dx = nx - gx, dy = ny - gy, dz = nz - gz
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz)
      if (dist > 0.0005) {
        const effFeed = isG0 ? RAPID_SPEED : Math.max(feed, 1)
        const dur = (dist / effFeed) * 60
        if (!isG0) totalTimeSec += dur
        moves.push({
          tx0: gx, ty0: gz, tz0: gy,
          tx1: nx, ty1: nz, tz1: ny,
          isRapid: isG0,
          durationSec: dur,
        })
      }
    }

    gx = nx; gy = ny; gz = nz
    hasPos = true
  }

  return { moves, estimatedMachiningSec: totalTimeSec }
}

// ── Parse print G-code for part mesh ─────────────────────────────────────────

function parsePrintSegments(gcode: string): PrintSegment[] {
  const segs: PrintSegment[] = []
  let x = 0, y = 0, z = 0, e = 0, hasPos = false
  let isSupport = false

  for (const raw of gcode.split('\n')) {
    const trimmed = raw.trim()
    if (trimmed.startsWith(';TYPE:')) {
      isSupport = trimmed.slice(6).trim().toUpperCase().startsWith('SUPPORT')
      continue
    }
    const line = trimmed.split(';')[0].trim()
    if (!line) continue
    const up = line.toUpperCase()
    if (up.startsWith('G92')) { const m = up.match(/E([+-]?[\d.]+)/); if (m) e = parseFloat(m[1]); continue }
    if (!up.startsWith('G0') && !up.startsWith('G1')) continue

    const xm = up.match(/X([+-]?[\d.]+)/), ym = up.match(/Y([+-]?[\d.]+)/), zm = up.match(/Z([+-]?[\d.]+)/), em = up.match(/E([+-]?[\d.]+)/)
    const nx = xm ? parseFloat(xm[1]) : x
    const ny = ym ? parseFloat(ym[1]) : y
    const nz = zm ? parseFloat(zm[1]) : z
    const ne = em ? parseFloat(em[1]) : e

    if (hasPos && em && ne > e)
      segs.push({ x0: x, y0: z, z0: y, x1: nx, y1: nz, z1: ny, isSupport })

    x = nx; y = ny; z = nz; e = ne; hasPos = true
  }
  return segs
}

// ── Build InstancedMesh for print segments ────────────────────────────────────

function buildPrintMesh(segs: PrintSegment[], lineWidth: number, scene: THREE.Scene): THREE.InstancedMesh[] {
  const BEAD_SEGS = 5
  const cylGeo = new THREE.CylinderGeometry(lineWidth / 2, lineWidth / 2, 1, BEAD_SEGS)
  const yAxis = new THREE.Vector3(0, 1, 0)
  const dummy = new THREE.Object3D()
  const dir = new THREE.Vector3()

  function makeMesh(filtered: PrintSegment[], color: number): THREE.InstancedMesh {
    const mat = new THREE.MeshPhongMaterial({ color, transparent: true, opacity: 0.55, specular: 0x111111 })
    const mesh = new THREE.InstancedMesh(cylGeo, mat, Math.max(filtered.length, 1))
    mesh.frustumCulled = false
    for (let i = 0; i < filtered.length; i++) {
      const { x0, y0, z0, x1, y1, z1 } = filtered[i]
      const dx = x1-x0, dy = y1-y0, dz = z1-z0
      const len = Math.sqrt(dx*dx + dy*dy + dz*dz)
      dummy.position.set((x0+x1)/2, (y0+y1)/2, (z0+z1)/2)
      if (len > 0.001) { dir.set(dx, dy, dz).normalize(); dummy.quaternion.setFromUnitVectors(yAxis, dir) } else dummy.quaternion.identity()
      dummy.scale.set(1, Math.max(len, 0.001), 1)
      dummy.updateMatrix()
      mesh.setMatrixAt(i, dummy.matrix)
    }
    mesh.instanceMatrix.needsUpdate = true
    scene.add(mesh)
    return mesh
  }

  const modelSegs = segs.filter(s => !s.isSupport)
  const suppSegs  = segs.filter(s =>  s.isSupport)
  const meshes: THREE.InstancedMesh[] = []
  if (modelSegs.length > 0) meshes.push(makeMesh(modelSegs, 0x1e40af))
  if (suppSegs.length  > 0) meshes.push(makeMesh(suppSegs,  0xf97316))
  return meshes
}

// ── Format seconds ────────────────────────────────────────────────────────────

function fmtTime(sec: number): string {
  if (sec < 60)  return `${Math.round(sec)}s`
  if (sec < 3600) return `${Math.floor(sec/60)}m ${Math.round(sec%60)}s`
  return `${Math.floor(sec/3600)}h ${Math.floor((sec%3600)/60)}m`
}

// ── Main component ────────────────────────────────────────────────────────────

const SPEEDS = [1, 2, 5, 10, 20, 50]

export default function CncSimulation({
  toolpathGCode, printGCode, buildVolume, toolDiameterMm = 3,
  unmachinableRegions = [], className,
}: Props) {
  const mountRef = useRef<HTMLDivElement>(null)

  const [playing, setPlaying] = useState(false)
  const [speed, setSpeed]     = useState(5)     // index into SPEEDS
  const [progress, setProgress] = useState(0)   // 0-1
  const [ended, setEnded]     = useState(false)

  // Animation state lives in refs to avoid stale closures
  const stateRef = useRef({ playing: false, speed: 5, moveIdx: 0, segProg: 0, lastTs: 0 })
  const rafRef   = useRef(0)

  // Three.js object refs
  const rendererRef  = useRef<THREE.WebGLRenderer | null>(null)
  const sceneRef     = useRef<THREE.Scene | null>(null)
  const cameraRef    = useRef<THREE.PerspectiveCamera | null>(null)
  const controlsRef  = useRef<OrbitControls | null>(null)
  const toolGroupRef = useRef<THREE.Group | null>(null)
  const traceGeoRef  = useRef<THREE.BufferGeometry | null>(null)
  const cursorGeoRef = useRef<THREE.BufferGeometry | null>(null)
  const movesRef     = useRef<SimMove[]>([])

  // Parse data once
  const { moves, estimatedMachiningSec } = useMemo(() => parseCncMoves(toolpathGCode), [toolpathGCode])
  const printSegs = useMemo(() => parsePrintSegments(printGCode), [printGCode])

  // Estimate parse/setup time for display
  const setupEstimateSec = useMemo(() => Math.max(1, Math.ceil((moves.length + printSegs.length) / 8000)), [moves.length, printSegs.length])

  // ── Build Three.js scene ────────────────────────────────────────────────────
  useEffect(() => {
    const el = mountRef.current
    if (!el) return

    // Cleanup previous
    cancelAnimationFrame(rafRef.current)
    controlsRef.current?.dispose()
    rendererRef.current?.dispose()
    if (rendererRef.current?.domElement && el.contains(rendererRef.current.domElement))
      el.removeChild(rendererRef.current.domElement)

    // Reset state
    stateRef.current = { playing: false, speed: SPEEDS[4], moveIdx: 0, segProg: 0, lastTs: 0 }
    setPlaying(false); setProgress(0); setEnded(false)
    movesRef.current = moves

    const w = Math.max(el.clientWidth, 1)
    const h = Math.max(el.clientHeight, 1)

    const renderer = new THREE.WebGLRenderer({ antialias: true })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.setSize(w, h)
    renderer.setClearColor(0x060a10)
    el.appendChild(renderer.domElement)
    rendererRef.current = renderer

    const scene = new THREE.Scene()
    scene.add(new THREE.AmbientLight(0xffffff, 0.6))
    const sun = new THREE.DirectionalLight(0xffffff, 1.0)
    sun.position.set(2, 3, 2)
    scene.add(sun)
    sceneRef.current = scene

    const camera = new THREE.PerspectiveCamera(50, w / h, 0.1, 20000)
    cameraRef.current = camera

    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping = true
    controls.dampingFactor = 0.1
    controlsRef.current = controls

    // ── Bed ──────────────────────────────────────────────────────────────
    const bw = buildVolume.width, bd = buildVolume.depth
    const hw = bw / 2, hd = bd / 2
    const bedPts = [
      new THREE.Vector3(-hw,0,-hd), new THREE.Vector3(hw,0,-hd),
      new THREE.Vector3(hw,0,-hd),  new THREE.Vector3(hw,0,hd),
      new THREE.Vector3(hw,0,hd),   new THREE.Vector3(-hw,0,hd),
      new THREE.Vector3(-hw,0,hd),  new THREE.Vector3(-hw,0,-hd),
    ]
    scene.add(new THREE.LineSegments(
      new THREE.BufferGeometry().setFromPoints(bedPts),
      new THREE.LineBasicMaterial({ color: 0x1e293b }),
    ))
    // Bed surface (semi-transparent)
    const bedMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(bw, bd),
      new THREE.MeshStandardMaterial({ color: 0x0f172a, transparent: true, opacity: 0.4, side: THREE.DoubleSide }),
    )
    bedMesh.rotation.x = -Math.PI / 2
    scene.add(bedMesh)

    // ── Printed part (static) ─────────────────────────────────────────────
    if (printSegs.length > 0)
      buildPrintMesh(printSegs, 0.4, scene)

    // ── Unmachinable regions (always-visible red boxes) ───────────────────
    if (unmachinableRegions.length > 0) {
      const unmachMat = new THREE.MeshBasicMaterial({
        color: 0xff2222,
        transparent: true,
        opacity: 0.28,
        side: THREE.DoubleSide,
        depthWrite: false,
      })
      const unmachEdgeMat = new THREE.LineBasicMaterial({ color: 0xff4444 })
      for (const r of unmachinableRegions) {
        const bx = r.bounds.minX, by = r.bounds.minY, bX = r.bounds.maxX, bY = r.bounds.maxY
        // Skip degenerate zero-area bounds (e.g. FluteTooShort placeholders)
        if (Math.abs(bX - bx) < 0.001 && Math.abs(bY - by) < 0.001) continue
        const w = Math.abs(bX - bx) || 1
        const d = Math.abs(bY - by) || 1
        const h = 1  // flat slab 1mm thick
        const cx = (bx + bX) / 2
        const cy = (by + bY) / 2
        // Three.js Y-up: part Z→Y, part Y→Z
        const boxGeo = new THREE.BoxGeometry(w, h, d)
        const boxMesh = new THREE.Mesh(boxGeo, unmachMat)
        // position: x=cx, y=zHeight (three-js Y), z=cy (three-js Z)
        boxMesh.position.set(cx, r.zHeightMm, cy)
        scene.add(boxMesh)
        const edgesGeo = new THREE.EdgesGeometry(boxGeo)
        const edgeLines = new THREE.LineSegments(edgesGeo, unmachEdgeMat)
        edgeLines.position.copy(boxMesh.position)
        scene.add(edgeLines)
      }
    }

    // ── Toolpath trace pre-allocated geometry ─────────────────────────────
    const numMoves = moves.length
    if (numMoves > 0) {
      const positions = new Float32Array(numMoves * 6)
      const colors    = new Float32Array(numMoves * 6)
      for (let i = 0; i < numMoves; i++) {
        const m = moves[i]
        const b = i * 6
        positions[b]   = m.tx0; positions[b+1] = m.ty0; positions[b+2] = m.tz0
        positions[b+3] = m.tx1; positions[b+4] = m.ty1; positions[b+5] = m.tz1
        const r = m.isRapid ? 0.9 : 0.15
        const g = m.isRapid ? 0.2 : 0.85
        const bl = m.isRapid ? 0.15 : 0.2
        colors[b]=r; colors[b+1]=g; colors[b+2]=bl
        colors[b+3]=r; colors[b+4]=g; colors[b+5]=bl
      }
      const traceGeo = new THREE.BufferGeometry()
      traceGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3))
      traceGeo.setAttribute('color',    new THREE.BufferAttribute(colors, 3))
      traceGeo.setDrawRange(0, 0)
      traceGeoRef.current = traceGeo
      scene.add(new THREE.LineSegments(traceGeo, new THREE.LineBasicMaterial({ vertexColors: true })))

      // Cursor line (current in-progress move, white)
      const cursorGeo = new THREE.BufferGeometry()
      const cursorPos = new Float32Array([0,0,0, 0,0,0])
      cursorGeo.setAttribute('position', new THREE.BufferAttribute(cursorPos, 3))
      cursorGeoRef.current = cursorGeo
      scene.add(new THREE.Line(cursorGeo, new THREE.LineBasicMaterial({ color: 0xffffff })))
    }

    // ── CNC Tool ──────────────────────────────────────────────────────────
    const toolRadius = toolDiameterMm / 2
    const shaftH     = Math.max(toolDiameterMm * 7, 20)
    const coneH      = toolRadius * 1.5
    const toolMat    = new THREE.MeshPhongMaterial({ color: 0xd1d5db, specular: 0x888888, shininess: 120 })
    const tipMat     = new THREE.MeshPhongMaterial({ color: 0xfbbf24, specular: 0xffffff, shininess: 200 })

    const toolGroup = new THREE.Group()
    const shaftGeo  = new THREE.CylinderGeometry(toolRadius, toolRadius, shaftH, 10)
    const shaftMesh = new THREE.Mesh(shaftGeo, toolMat)
    shaftMesh.position.y = shaftH / 2    // tip at y=0, shaft extends up
    toolGroup.add(shaftMesh)

    const coneGeo  = new THREE.ConeGeometry(toolRadius, coneH, 10)
    const coneMesh = new THREE.Mesh(coneGeo, tipMat)
    coneMesh.position.y = -coneH / 2   // tip at y=0, cone points down
    coneMesh.rotation.z = Math.PI
    toolGroup.add(coneMesh)

    // Start tool at first move position
    if (moves.length > 0) {
      const m0 = moves[0]
      toolGroup.position.set(m0.tx0, m0.ty0, m0.tz0)
    }
    scene.add(toolGroup)
    toolGroupRef.current = toolGroup

    // ── Camera position ────────────────────────────────────────────────────
    const box = new THREE.Box3()
    for (const m of moves) {
      box.expandByPoint(new THREE.Vector3(m.tx0, m.ty0, m.tz0))
      box.expandByPoint(new THREE.Vector3(m.tx1, m.ty1, m.tz1))
    }
    for (const s of printSegs) {
      box.expandByPoint(new THREE.Vector3(s.x0, s.y0, s.z0))
      box.expandByPoint(new THREE.Vector3(s.x1, s.y1, s.z1))
    }
    const hasData = moves.length > 0 || printSegs.length > 0
    const center  = hasData ? box.getCenter(new THREE.Vector3()) : new THREE.Vector3(0, 0, 0)
    const span    = hasData ? box.getSize(new THREE.Vector3()) : new THREE.Vector3(bw, 100, bd)
    const d = Math.max(span.x, span.y, span.z, bw * 0.5) * 1.8
    camera.position.set(center.x - d * 0.3, center.y + d * 0.7, center.z + d)
    camera.lookAt(center)
    controls.target.copy(center)
    controls.update()

    // ── Render loop ────────────────────────────────────────────────────────
    let animId: number
    const tick = () => {
      animId = requestAnimationFrame(tick)
      controls.update()
      renderer.render(scene, camera)
    }
    tick()

    const ro = new ResizeObserver(() => {
      const nw = el.clientWidth, nh = el.clientHeight
      if (nw > 0 && nh > 0) { camera.aspect = nw/nh; camera.updateProjectionMatrix(); renderer.setSize(nw, nh) }
    })
    ro.observe(el)

    return () => {
      cancelAnimationFrame(animId)
      cancelAnimationFrame(rafRef.current)
      ro.disconnect()
      controls.dispose()
      renderer.dispose()
      if (el.contains(renderer.domElement)) el.removeChild(renderer.domElement)
      sceneRef.current = null
      rendererRef.current = null
      toolGroupRef.current = null
      traceGeoRef.current = null
      cursorGeoRef.current = null
    }
  }, [toolpathGCode, printGCode, buildVolume, toolDiameterMm, unmachinableRegions]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Sync speed ref ─────────────────────────────────────────────────────────
  useEffect(() => { stateRef.current.speed = SPEEDS[speed] }, [speed])

  // ── Animation tick ref (always up-to-date) ─────────────────────────────────
  const tickFnRef = useRef<(ts: number) => void>(() => {})
  tickFnRef.current = (timestamp: number) => {
    const state = stateRef.current
    if (!state.playing) return

    const dt = Math.min((timestamp - state.lastTs) / 1000, 0.05)  // cap at 50ms
    state.lastTs = timestamp

    const moves = movesRef.current
    if (state.moveIdx >= moves.length) {
      state.playing = false
      setPlaying(false)
      setEnded(true)
      setProgress(1)
      return
    }

    const move = moves[state.moveIdx]
    const moveDur = Math.max(move.durationSec / state.speed, 0.0001)
    state.segProg += dt / moveDur

    while (state.segProg >= 1 && state.moveIdx < moves.length - 1) {
      state.segProg -= 1
      state.moveIdx++
    }

    if (state.moveIdx >= moves.length - 1 && state.segProg >= 1) {
      state.segProg = 1
      state.playing = false
      setPlaying(false)
      setEnded(true)
    }

    // Interpolate current position
    const m = moves[Math.min(state.moveIdx, moves.length - 1)]
    const t = Math.min(state.segProg, 1)
    const cx = m.tx0 + (m.tx1 - m.tx0) * t
    const cy = m.ty0 + (m.ty1 - m.ty0) * t
    const cz = m.tz0 + (m.tz1 - m.tz0) * t

    // Move tool
    const tool = toolGroupRef.current
    if (tool) tool.position.set(cx, cy, cz)

    // Update completed trace draw range
    const traceGeo = traceGeoRef.current
    if (traceGeo) traceGeo.setDrawRange(0, state.moveIdx * 2)

    // Update cursor line (from current move start to current position)
    const cursorGeo = cursorGeoRef.current
    if (cursorGeo) {
      const pos = cursorGeo.attributes.position as THREE.BufferAttribute
      pos.setXYZ(0, m.tx0, m.ty0, m.tz0)
      pos.setXYZ(1, cx, cy, cz)
      pos.needsUpdate = true
    }

    // Update UI progress (throttled to avoid thrashing)
    setProgress(state.moveIdx / Math.max(moves.length, 1))

    if (state.playing)
      rafRef.current = requestAnimationFrame(ts => tickFnRef.current(ts))
  }

  // ── Play/pause control ──────────────────────────────────────────────────────
  useEffect(() => {
    stateRef.current.playing = playing
    if (playing) {
      stateRef.current.lastTs = performance.now()
      rafRef.current = requestAnimationFrame(ts => tickFnRef.current(ts))
    } else {
      cancelAnimationFrame(rafRef.current)
    }
  }, [playing]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleReset = () => {
    cancelAnimationFrame(rafRef.current)
    stateRef.current = { ...stateRef.current, playing: false, moveIdx: 0, segProg: 0 }
    setPlaying(false)
    setEnded(false)
    setProgress(0)
    if (traceGeoRef.current) traceGeoRef.current.setDrawRange(0, 0)
    if (cursorGeoRef.current) {
      const pos = cursorGeoRef.current.attributes.position as THREE.BufferAttribute
      pos.setXYZ(0, 0, 0, 0); pos.setXYZ(1, 0, 0, 0); pos.needsUpdate = true
    }
    if (toolGroupRef.current && moves.length > 0) {
      const m0 = moves[0]
      toolGroupRef.current.position.set(m0.tx0, m0.ty0, m0.tz0)
    }
  }

  const simTimeSec = estimatedMachiningSec / SPEEDS[speed]

  return (
    <div className={`flex flex-col gap-3 ${className ?? ''}`}>
      {/* Legend / Info bar */}
      <div className="bg-gray-900 border border-gray-800 rounded-lg px-3 py-2 flex flex-wrap items-center gap-4 text-xs text-gray-400">
        <span className="font-medium text-gray-300 mr-1">Legend:</span>
        <span><span className="inline-block w-3 h-3 rounded-sm bg-yellow-400 mr-1"></span>Rapid (G0)</span>
        <span><span className="inline-block w-3 h-3 rounded-sm bg-cyan-400 mr-1"></span>Cut (G1)</span>
        <span><span className="inline-block w-3 h-3 rounded-sm bg-blue-600 mr-1"></span>Printed</span>
        <span><span className="inline-block w-3 h-3 rounded-sm bg-orange-500 mr-1"></span>Support</span>
        {unmachinableRegions.length > 0 && (
          <span className="text-red-400">
            <span className="inline-block w-3 h-3 rounded-sm bg-red-600 mr-1 opacity-70"></span>
            Unmachinable ({unmachinableRegions.length})
          </span>
        )}
        <span><span className="text-yellow-300">■</span> Tool tip</span>
        <span className="ml-auto text-gray-500">
          {moves.length} moves · machining time: {fmtTime(estimatedMachiningSec)} · setup est: ~{setupEstimateSec}s
        </span>
      </div>

      {/* 3D viewport */}
      <div
        ref={mountRef}
        className="bg-gray-950 rounded-xl border border-gray-700 overflow-hidden flex-1"
        style={{ minHeight: '55vh' }}
      />

      {/* Controls */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 flex flex-col gap-3">
        {/* Progress bar */}
        <div className="relative h-2 bg-gray-800 rounded-full overflow-hidden">
          <div
            className="absolute left-0 top-0 h-full bg-green-500 transition-none rounded-full"
            style={{ width: `${progress * 100}%` }}
          />
        </div>

        {/* Buttons + speed */}
        <div className="flex items-center gap-3 flex-wrap">
          <button
            onClick={() => { if (ended) handleReset(); setPlaying(p => !p) }}
            className="flex items-center gap-2 px-5 py-2 rounded-lg bg-green-700 hover:bg-green-600 text-white text-sm font-medium transition"
          >
            {ended ? '↺ Restart' : playing ? '⏸ Pause' : '▶ Play'}
          </button>

          <button
            onClick={handleReset}
            disabled={progress === 0 && !playing}
            className="px-4 py-2 rounded-lg bg-gray-700 hover:bg-gray-600 disabled:opacity-40 text-gray-200 text-sm transition"
          >
            ↺ Reset
          </button>

          <div className="flex items-center gap-2 ml-auto">
            <span className="text-xs text-gray-400">Speed</span>
            <div className="flex gap-1">
              {SPEEDS.map((s, i) => (
                <button
                  key={s}
                  onClick={() => setSpeed(i)}
                  className={`px-2.5 py-1 rounded text-xs transition ${
                    speed === i
                      ? 'bg-primary text-white'
                      : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
                  }`}
                >
                  {s}x
                </button>
              ))}
            </div>
          </div>

          <span className="text-xs text-gray-500 ml-2">
            sim time: {fmtTime(simTimeSec)}
          </span>
        </div>

        {ended && (
          <p className="text-xs text-green-400 text-center">Simulation complete — toolpath fully traced.</p>
        )}
      </div>
    </div>
  )
}
