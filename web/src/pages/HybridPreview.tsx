import { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { jobsApi, printProfilesApi, machineProfilesApi, customGCodeApi } from '../api/client'
import DisabledHint from '../components/DisabledHint'
import type { PrintJob } from '../types'

// ─────────────────────────────────────────────────────────────────────────────
// G-code parsers
// ─────────────────────────────────────────────────────────────────────────────

interface PrintSeg {
  x0: number; z0: number; y0: number   // THREE.js: X=gcodeX, Y=gcodeZ(height), Z=gcodeY
  x1: number; z1: number; y1: number
  layerIdx: number
  isSupport: boolean                    // true for ;TYPE:SUPPORT / SUPPORT_INTERFACE
}

interface CncMoveSim {
  x: number; z: number; y: number
  rapid: boolean
  blockIdx: number
}

interface ParsedPrint {
  segs: PrintSeg[]
  layerBoundaries: number[]  // segs index where each Cura layer starts
  maxZ: number
  // Prefix-sum counts for part vs support segments
  // partPrefix[i] = # of part segs in segs[0..i-1], suppPrefix[i] = support segs
  partPrefix: Int32Array
  suppPrefix: Int32Array
}

/** Parse the full print G-code — walls, infill, supports, everything.
 *  Cura TYPE comments are used to colour-code support vs part material. */
function parsePrintGCode(gcode: string): ParsedPrint {
  const segs: PrintSeg[] = []
  const layerBoundaries: number[] = [0]
  let cx = 0, cy = 0, cz = 0, ce = 0, hasPos = false, layerIdx = 0, maxZ = 0
  let isSupport = false

  for (const raw of gcode.split('\n')) {
    const t = raw.trim()

    // Cura type markers — detect support regions
    if (t.startsWith(';TYPE:')) {
      const typ = t.slice(6).toUpperCase()
      isSupport = typ.startsWith('SUPPORT')
      continue
    }

    // Layer markers
    if (t.startsWith(';LAYER:')) {
      if (segs.length > layerBoundaries[layerBoundaries.length - 1]) {
        layerBoundaries.push(segs.length)
        layerIdx++
      }
      continue
    }

    const line = t.split(';')[0].trim()
    if (!line) continue
    const up = line.toUpperCase()
    if (!up.startsWith('G0') && !up.startsWith('G1')) continue

    const xm = up.match(/X([+-]?[\d.]+)/), ym = up.match(/Y([+-]?[\d.]+)/)
    const zm = up.match(/Z([+-]?[\d.]+)/), em = up.match(/E([+-]?[\d.]+)/)
    const nx = xm ? parseFloat(xm[1]) : cx
    const ny = ym ? parseFloat(ym[1]) : cy
    const nz = zm ? parseFloat(zm[1]) : cz
    const ne = em ? parseFloat(em[1]) : ce

    if (hasPos && em && ne > ce) {
      segs.push({ x0: cx, z0: cz, y0: cy, x1: nx, z1: nz, y1: ny, layerIdx, isSupport })
      if (nz > maxZ) maxZ = nz
    }
    cx = nx; cy = ny; cz = nz; ce = ne; hasPos = true
  }
  layerBoundaries.push(segs.length)

  // Build prefix sums so animation can look up part/support counts in O(1)
  const partPrefix = new Int32Array(segs.length + 1)
  const suppPrefix = new Int32Array(segs.length + 1)
  for (let i = 0; i < segs.length; i++) {
    partPrefix[i + 1] = partPrefix[i] + (segs[i].isSupport ? 0 : 1)
    suppPrefix[i + 1] = suppPrefix[i] + (segs[i].isSupport ? 1 : 0)
  }

  return { segs, layerBoundaries, maxZ, partPrefix, suppPrefix }
}

/** Parse the real CNC toolpath G-code. */
function parseCncGCode(gcode: string): { moves: CncMoveSim[]; blockBoundaries: number[] } {
  const moves: CncMoveSim[] = []
  const blockBoundaries: number[] = [0]
  let cx = 0, cy = 0, cz = 0, hasPos = false, blockIdx = 0

  for (const raw of gcode.split('\n')) {
    const t = raw.trim()
    if (/^;.*Layer\s+\d+/i.test(t) || t.startsWith('; === Postamble') || t.startsWith('; === Preamble')) {
      if (moves.length > blockBoundaries[blockBoundaries.length - 1]) {
        blockBoundaries.push(moves.length)
        blockIdx++
      }
      continue
    }
    const line = t.split(';')[0].trim()
    if (!line) continue
    const up = line.toUpperCase()
    const isG0 = /^G0($|\s)/.test(up), isG1 = /^G1($|\s)/.test(up)
    if (!isG0 && !isG1) continue
    const xm = up.match(/X([+-]?[\d.]+)/), ym = up.match(/Y([+-]?[\d.]+)/), zm = up.match(/Z([+-]?[\d.]+)/)
    const nx = xm ? parseFloat(xm[1]) : cx
    const ny = ym ? parseFloat(ym[1]) : cy
    const nz = zm ? parseFloat(zm[1]) : cz
    if (hasPos) {
      const dx = nx - cx, dy = ny - cy, dz = nz - cz
      if (dx * dx + dy * dy + dz * dz > 0.0001)
        moves.push({ x: nx, z: nz, y: ny, rapid: isG0, blockIdx })
    }
    cx = nx; cy = ny; cz = nz; hasPos = true
  }
  blockBoundaries.push(moves.length)
  return { moves, blockBoundaries }
}

// ─────────────────────────────────────────────────────────────────────────────
// Stage builder
// ─────────────────────────────────────────────────────────────────────────────

interface PrintStage   { type: 'print';   printSegStart: number; printSegEnd: number; label: string }
interface MachineStage { type: 'machine'; cncMoveStart: number;  cncMoveEnd: number;  label: string }
type SimStage = PrintStage | MachineStage

function buildStages(
  printLayerBoundaries: number[],
  cncBlockBoundaries: number[],
  machinedLayers: number[],
  totalPrintLayers: number,
): SimStage[] {
  if (machinedLayers.length === 0)
    return [{ type: 'print', printSegStart: 0, printSegEnd: printLayerBoundaries[printLayerBoundaries.length - 1], label: `Print all ${totalPrintLayers} layers` }]

  const stages: SimStage[] = []
  let lastPrintLayer = 0, cncBlockIdx = 0

  for (const ml of machinedLayers) {
    const pStart = printLayerBoundaries[Math.min(lastPrintLayer, printLayerBoundaries.length - 1)]
    const pEnd   = printLayerBoundaries[Math.min(ml, printLayerBoundaries.length - 1)]
    if (pEnd > pStart)
      stages.push({ type: 'print', printSegStart: pStart, printSegEnd: pEnd, label: `Print L${lastPrintLayer + 1}–L${ml}` })

    const cStart = cncBlockBoundaries[Math.min(cncBlockIdx, cncBlockBoundaries.length - 1)]
    const cEnd   = cncBlockBoundaries[Math.min(cncBlockIdx + 1, cncBlockBoundaries.length - 1)]
    if (cEnd > cStart)
      stages.push({ type: 'machine', cncMoveStart: cStart, cncMoveEnd: cEnd, label: `CNC @ L${ml}` })

    lastPrintLayer = ml
    cncBlockIdx++
  }

  const pStart = printLayerBoundaries[Math.min(lastPrintLayer, printLayerBoundaries.length - 1)]
  const pEnd   = printLayerBoundaries[printLayerBoundaries.length - 1]
  if (pEnd > pStart)
    stages.push({ type: 'print', printSegStart: pStart, printSegEnd: pEnd, label: `Print L${lastPrintLayer + 1}–L${totalPrintLayers}` })

  return stages
}

// Speed mapping: slider 1-100 → segs/sec on log scale (~3 to ~3 000)
function sliderToSegsPerSec(v: number): number {
  return Math.round(Math.pow(10, 0.5 + (v / 100) * 3))
}

// ─────────────────────────────────────────────────────────────────────────────
// Visibility state (what layers / objects are shown in the 3D scene)
// ─────────────────────────────────────────────────────────────────────────────

interface Visibility {
  part: boolean
  support: boolean
  cncRapid: boolean
  cncCut: boolean
  nozzle: boolean
  tool: boolean
}

// ─────────────────────────────────────────────────────────────────────────────
// Three.js Hybrid Simulation Viewer
// ─────────────────────────────────────────────────────────────────────────────

interface ViewerProps {
  printGCode: string
  cncGCode: string
  machinedLayers: number[]
  totalPrintLayers: number
  layerHeightMm: number
  nozzleDiameterMm: number
  toolDiameterMm: number
  bedWidth: number
  bedDepth: number
}

function HybridSimViewer({
  printGCode, cncGCode, machinedLayers, totalPrintLayers,
  layerHeightMm, nozzleDiameterMm, toolDiameterMm, bedWidth, bedDepth
}: ViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const rendererRef  = useRef<THREE.WebGLRenderer | null>(null)
  const cameraRef    = useRef<THREE.PerspectiveCamera | null>(null)
  const controlsRef  = useRef<OrbitControls | null>(null)
  const animFrameRef = useRef<number>(0)
  const tickFrameRef = useRef<number>(0)

  const isPlayingRef = useRef(false)
  const stageIdxRef  = useRef(0)
  const progressRef  = useRef(0)
  const speedRef     = useRef(1)   // slider value 1-100

  const parsed = useMemo(() => {
    const print  = parsePrintGCode(printGCode)
    const cnc    = parseCncGCode(cncGCode)
    const stages = buildStages(print.layerBoundaries, cnc.blockBoundaries, machinedLayers, totalPrintLayers)
    return { print, cnc, stages }
  }, [printGCode, cncGCode, machinedLayers, totalPrintLayers])

  const [stageIdx,      setStageIdx]      = useState(0)
  const [isPlaying,     setIsPlaying]     = useState(false)
  const [speed,         setSpeed]         = useState(15)       // default low-range slider value
  const [stageProgress, setStageProgress] = useState(0)
  const [vis, setVis] = useState<Visibility>({
    part: true, support: true, cncRapid: true, cncCut: true, nozzle: true, tool: true,
  })

  useEffect(() => { speedRef.current = speed }, [speed])

  // Refs for scene objects that need to be accessed in animation / jump
  const partMeshRef    = useRef<THREE.InstancedMesh | null>(null)
  const supportMeshRef = useRef<THREE.InstancedMesh | null>(null)
  const cncRapidRef    = useRef<THREE.LineSegments | null>(null)
  const cncCutRef      = useRef<THREE.LineSegments | null>(null)
  const nozzleRef      = useRef<THREE.Group | null>(null)
  const toolRef        = useRef<THREE.Group | null>(null)

  // Apply visibility changes immediately to scene objects
  useEffect(() => {
    if (partMeshRef.current)    partMeshRef.current.visible    = vis.part
    if (supportMeshRef.current) supportMeshRef.current.visible = vis.support
    if (cncRapidRef.current)    cncRapidRef.current.visible    = vis.cncRapid
    if (cncCutRef.current)      cncCutRef.current.visible      = vis.cncCut
    // nozzle / tool visibility is managed per-frame during animation;
    // when not playing we also honour the toggle
    if (!isPlaying) {
      if (nozzleRef.current) nozzleRef.current.visible = vis.nozzle && (nozzleRef.current.visible)
      if (toolRef.current)   toolRef.current.visible   = vis.tool   && (toolRef.current.visible)
    }
  }, [vis, isPlaying])

  // ── Setup Three.js ────────────────────────────────────────────────────────
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const w = el.clientWidth, h = el.clientHeight || 500

    const scene = new THREE.Scene()
    scene.background = new THREE.Color(0x0d0d14)

    const camera = new THREE.PerspectiveCamera(45, w / h, 0.1, 5000)
    camera.position.set(0, 150, 280)
    cameraRef.current = camera

    const renderer = new THREE.WebGLRenderer({ antialias: true })
    renderer.setSize(w, h)
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    el.appendChild(renderer.domElement)
    rendererRef.current = renderer

    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping = true
    controls.dampingFactor = 0.08
    controlsRef.current = controls

    scene.add(new THREE.AmbientLight(0xffffff, 0.6))
    const dir = new THREE.DirectionalLight(0xffffff, 1.4)
    dir.position.set(150, 200, 100)
    scene.add(dir)
    const fill = new THREE.DirectionalLight(0x8888ff, 0.4)
    fill.position.set(-100, -50, -100)
    scene.add(fill)

    const bedGeo = new THREE.PlaneGeometry(bedWidth, bedDepth)
    bedGeo.rotateX(-Math.PI / 2)
    scene.add(new THREE.Mesh(bedGeo, new THREE.MeshPhongMaterial({ color: 0x1a1a2e, side: THREE.DoubleSide })))
    scene.add(new THREE.GridHelper(Math.max(bedWidth, bedDepth), 20, 0x333355, 0x222233))
    scene.add(new THREE.AxesHelper(30))

    // ── Two InstancedMesh objects: part (blue) and support (orange) ──────────
    const { segs, partPrefix, suppPrefix } = parsed.print
    const filW = Math.max(nozzleDiameterMm, 0.3) * 2.0
    const filH = Math.max(layerHeightMm,    0.1) * 1.5
    const cylGeo = new THREE.CylinderGeometry(0.5, 0.5, 1, 6)

    const nPart = partPrefix[segs.length]
    const nSupp = suppPrefix[segs.length]

    const partMesh = new THREE.InstancedMesh(cylGeo, new THREE.MeshPhongMaterial({ color: 0x2277dd }), Math.max(nPart, 1))
    partMesh.count = 0
    scene.add(partMesh)
    partMeshRef.current = partMesh

    const suppMesh = new THREE.InstancedMesh(cylGeo, new THREE.MeshPhongMaterial({ color: 0xff8800 }), Math.max(nSupp, 1))
    suppMesh.count = 0
    scene.add(suppMesh)
    supportMeshRef.current = suppMesh

    const dummy = new THREE.Object3D()
    const up    = new THREE.Vector3(0, 1, 0)
    let   pi = 0, si = 0

    for (let i = 0; i < segs.length; i++) {
      const s     = segs[i]
      const start = new THREE.Vector3(s.x0, s.z0, s.y0)
      const end   = new THREE.Vector3(s.x1, s.z1, s.y1)
      const dir3  = end.clone().sub(start)
      const len   = dir3.length()
      const target = s.isSupport ? suppMesh : partMesh
      const idx    = s.isSupport ? si++     : pi++
      if (len < 0.001) {
        dummy.scale.set(0, 0, 0); dummy.position.set(0, 0, 0); dummy.updateMatrix()
      } else {
        dummy.position.copy(start.clone().add(end).multiplyScalar(0.5))
        dummy.quaternion.setFromUnitVectors(up, dir3.clone().normalize())
        dummy.scale.set(filW, len, filH)
        dummy.updateMatrix()
      }
      target.setMatrixAt(idx, dummy.matrix)
    }
    partMesh.instanceMatrix.needsUpdate = true
    suppMesh.instanceMatrix.needsUpdate = true

    // ── CNC paths ─────────────────────────────────────────────────────────────
    {
      let cx2 = 0, cy2 = 0, cz2 = 0, hasPos2 = false
      const rapidPos: number[] = [], cutPos: number[] = []
      for (const raw of cncGCode.split('\n')) {
        const line = raw.split(';')[0].trim()
        if (!line) continue
        const up2 = line.toUpperCase()
        const isG0 = /^G0($|\s)/.test(up2), isG1 = /^G1($|\s)/.test(up2)
        if (!isG0 && !isG1) continue
        const xm = up2.match(/X([+-]?[\d.]+)/), ym = up2.match(/Y([+-]?[\d.]+)/), zm = up2.match(/Z([+-]?[\d.]+)/)
        const nx = xm ? parseFloat(xm[1]) : cx2
        const ny = ym ? parseFloat(ym[1]) : cy2
        const nz = zm ? parseFloat(zm[1]) : cz2
        if (hasPos2) {
          const arr = isG0 ? rapidPos : cutPos
          arr.push(cx2, cz2, cy2, nx, nz, ny)
        }
        cx2 = nx; cy2 = ny; cz2 = nz; hasPos2 = true
      }
      const rapidGeo = new THREE.BufferGeometry()
      rapidGeo.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(rapidPos), 3))
      rapidGeo.setDrawRange(0, 0)
      const rapidLines = new THREE.LineSegments(rapidGeo, new THREE.LineBasicMaterial({ color: 0xffcc00 }))
      scene.add(rapidLines)
      cncRapidRef.current = rapidLines

      const cutGeo = new THREE.BufferGeometry()
      cutGeo.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(cutPos), 3))
      cutGeo.setDrawRange(0, 0)
      const cutLines = new THREE.LineSegments(cutGeo, new THREE.LineBasicMaterial({ color: 0x2288ff }))
      scene.add(cutLines)
      cncCutRef.current = cutLines
    }

    // ── FDM Nozzle (hot-end shape, orange tip) ────────────────────────────────
    const nozzleGroup = new THREE.Group()
    nozzleGroup.visible = false
    const blockMesh2 = new THREE.Mesh(new THREE.BoxGeometry(8, 8, 8), new THREE.MeshPhongMaterial({ color: 0xc8960c, shininess: 60 }))
    blockMesh2.position.y = 12; nozzleGroup.add(blockMesh2)
    const hbMesh2 = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 1.5, 10, 8), new THREE.MeshPhongMaterial({ color: 0x444444 }))
    hbMesh2.position.y = 21; nozzleGroup.add(hbMesh2)
    const tipR  = Math.max(nozzleDiameterMm / 2, 0.6)
    const tipGeo2 = new THREE.ConeGeometry(tipR * 3, 6, 8); tipGeo2.rotateX(Math.PI)
    const tipMesh2 = new THREE.Mesh(tipGeo2, new THREE.MeshPhongMaterial({ color: 0xff8c00, shininess: 80 }))
    tipMesh2.position.y = 5; nozzleGroup.add(tipMesh2)
    scene.add(nozzleGroup)
    nozzleRef.current = nozzleGroup

    // ── CNC End Mill (tapered flute + collet) ─────────────────────────────────
    const toolGroup = new THREE.Group()
    toolGroup.visible = false
    const tr = Math.max(toolDiameterMm / 2, 1.0)
    const fluteMesh2 = new THREE.Mesh(new THREE.CylinderGeometry(tr * 0.9, tr, 18, 12), new THREE.MeshPhongMaterial({ color: 0xd8d8d8, shininess: 120 }))
    fluteMesh2.position.y = 9; toolGroup.add(fluteMesh2)
    const botMesh2 = new THREE.Mesh(new THREE.CircleGeometry(tr, 12), new THREE.MeshPhongMaterial({ color: 0xaaaaaa, side: THREE.DoubleSide }))
    botMesh2.rotation.x = Math.PI / 2; botMesh2.position.y = 0; toolGroup.add(botMesh2)
    const shankMesh2 = new THREE.Mesh(new THREE.CylinderGeometry(tr * 1.3, tr * 1.3, 20, 10), new THREE.MeshPhongMaterial({ color: 0x888888, shininess: 60 }))
    shankMesh2.position.y = 28; toolGroup.add(shankMesh2)
    const colletMesh2 = new THREE.Mesh(new THREE.TorusGeometry(tr * 1.5, tr * 0.3, 6, 12), new THREE.MeshPhongMaterial({ color: 0x555555 }))
    colletMesh2.position.y = 38; colletMesh2.rotation.x = Math.PI / 2; toolGroup.add(colletMesh2)
    scene.add(toolGroup)
    toolRef.current = toolGroup

    const onResize = () => {
      const w2 = el.clientWidth, h2 = el.clientHeight
      camera.aspect = w2 / h2; camera.updateProjectionMatrix()
      renderer.setSize(w2, h2)
    }
    window.addEventListener('resize', onResize)

    const animate = () => {
      animFrameRef.current = requestAnimationFrame(animate)
      controls.update()
      renderer.render(scene, camera)
    }
    animate()

    return () => {
      cancelAnimationFrame(animFrameRef.current)
      window.removeEventListener('resize', onResize)
      controls.dispose(); renderer.dispose()
      el.removeChild(renderer.domElement)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [parsed, nozzleDiameterMm, layerHeightMm, toolDiameterMm, bedWidth, bedDepth])

  // ── Animation tick ────────────────────────────────────────────────────────
  useEffect(() => {
    if (!isPlaying) { isPlayingRef.current = false; return }
    isPlayingRef.current = true
    const stages = parsed.stages
    let lastTime = performance.now()

    const tick = () => {
      if (!isPlayingRef.current) return
      const now = performance.now()
      const dt  = Math.min((now - lastTime) / 1000, 0.1)   // cap dt to avoid big jumps
      lastTime  = now

      const si = stageIdxRef.current
      if (si >= stages.length) { isPlayingRef.current = false; setIsPlaying(false); return }

      const stage = stages[si]
      const SEGS_PER_SEC = sliderToSegsPerSec(speedRef.current)

      if (stage.type === 'print') {
        const total = stage.printSegEnd - stage.printSegStart
        const added = Math.ceil(SEGS_PER_SEC * dt)
        const np    = Math.min(progressRef.current + added / Math.max(total, 1), 1)
        progressRef.current = np

        const visCount = stage.printSegStart + Math.floor(np * total)
        const { partPrefix, suppPrefix } = parsed.print
        if (partMeshRef.current)    partMeshRef.current.count    = partPrefix[visCount]
        if (supportMeshRef.current) supportMeshRef.current.count = suppPrefix[visCount]

        if (nozzleRef.current) {
          const { segs } = parsed.print
          const segIdx = Math.min(visCount, segs.length - 1)
          if (segIdx >= 0) {
            const s = segs[segIdx]
            nozzleRef.current.position.set(s.x1, s.z1 + layerHeightMm, s.y1)
            nozzleRef.current.visible = vis.nozzle
          }
        }
        if (toolRef.current) toolRef.current.visible = false

        setStageProgress(np)
        if (np >= 1) { stageIdxRef.current = si + 1; progressRef.current = 0; setStageIdx(si + 1); setStageProgress(0) }

      } else {
        const total = stage.cncMoveEnd - stage.cncMoveStart
        const added = Math.ceil(SEGS_PER_SEC * dt)
        const np    = Math.min(progressRef.current + added / Math.max(total, 1), 1)
        progressRef.current = np

        const visEnd = stage.cncMoveStart + Math.floor(np * total)
        const { moves } = parsed.cnc
        let rapidIdx = 0, cutIdx = 0
        for (let i = 0; i < visEnd && i < moves.length; i++) {
          if (moves[i].rapid) rapidIdx++; else cutIdx++
        }
        if (cncRapidRef.current) cncRapidRef.current.geometry.setDrawRange(0, rapidIdx * 2)
        if (cncCutRef.current)   cncCutRef.current.geometry.setDrawRange(0, cutIdx * 2)

        if (toolRef.current && visEnd > 0 && visEnd <= moves.length) {
          const m = moves[Math.max(0, visEnd - 1)]
          toolRef.current.position.set(m.x, m.z, m.y)
          toolRef.current.visible = vis.tool
        }
        if (nozzleRef.current) nozzleRef.current.visible = false

        setStageProgress(np)
        if (np >= 1) { stageIdxRef.current = si + 1; progressRef.current = 0; setStageIdx(si + 1); setStageProgress(0) }
      }

      tickFrameRef.current = requestAnimationFrame(tick)
    }

    tickFrameRef.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(tickFrameRef.current)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPlaying, parsed, layerHeightMm, vis])

  // ── Jump to stage ─────────────────────────────────────────────────────────
  const jumpToStage = useCallback((idx: number) => {
    const stages = parsed.stages
    if (idx < 0 || idx >= stages.length) return
    stageIdxRef.current = idx; progressRef.current = 0
    setStageIdx(idx); setStageProgress(0)

    let maxSeg = 0
    for (let i = 0; i < idx; i++) {
      const s = stages[i]
      if (s.type === 'print') maxSeg = s.printSegEnd
    }
    const { partPrefix, suppPrefix } = parsed.print
    if (partMeshRef.current)    partMeshRef.current.count    = partPrefix[maxSeg]
    if (supportMeshRef.current) supportMeshRef.current.count = suppPrefix[maxSeg]

    let maxCncMove = 0
    for (let i = 0; i < idx; i++) {
      const s = stages[i]
      if (s.type === 'machine') maxCncMove = s.cncMoveEnd
    }
    if (cncRapidRef.current) cncRapidRef.current.geometry.setDrawRange(0, maxCncMove * 2)
    if (cncCutRef.current)   cncCutRef.current.geometry.setDrawRange(0, maxCncMove * 2)

    if (nozzleRef.current) nozzleRef.current.visible = false
    if (toolRef.current)   toolRef.current.visible   = false
  }, [parsed])

  const stages = parsed.stages
  const currentStage = stages[stageIdx]
  const segsPerSec   = sliderToSegsPerSec(speed)

  // ── Legend toggle helper ─────────────────────────────────────────────────
  const Toggle = ({ label, color, field }: { label: string; color: string; field: keyof Visibility }) => (
    <button
      onClick={() => setVis(v => ({ ...v, [field]: !v[field] }))}
      className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-medium border transition select-none ${
        vis[field]
          ? 'bg-gray-800 border-gray-600 text-gray-200'
          : 'bg-gray-950 border-gray-800 text-gray-600 line-through opacity-50'
      }`}
    >
      <span className="inline-block w-3 h-3 rounded-sm shrink-0" style={{ background: color }} />
      {label}
    </button>
  )

  return (
    <div className="flex flex-col h-full">
      {/* Controls bar */}
      <div className="flex items-center gap-3 px-4 py-2 bg-gray-900 border-b border-gray-800 flex-wrap">
        <button
          onClick={() => setIsPlaying(p => !p)}
          className={`px-4 py-1.5 rounded-lg text-sm font-medium transition ${
            isPlaying ? 'bg-red-800 hover:bg-red-700 text-red-200' : 'bg-green-800 hover:bg-green-700 text-green-200'
          }`}
        >
          {isPlaying ? '⏸ Pause' : '▶ Play'}
        </button>

        <button onClick={() => jumpToStage(0)} className="px-3 py-1.5 text-xs bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-lg">
          ⏮ Reset
        </button>

        {/* Speed — logarithmic slider 1-100 */}
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-500">Slow</span>
          <input
            type="range" min={1} max={100} value={speed}
            onChange={e => setSpeed(+e.target.value)}
            className="w-28 accent-primary"
          />
          <span className="text-xs text-gray-500">Fast</span>
          <span className="text-[10px] text-gray-600 ml-1 tabular-nums w-16">
            {segsPerSec >= 1000 ? `${(segsPerSec / 1000).toFixed(1)}k` : segsPerSec} seg/s
          </span>
        </div>

        <div className="flex items-center gap-2 ml-2">
          <span className="text-xs text-gray-500">Stage</span>
          <select value={stageIdx} onChange={e => jumpToStage(+e.target.value)} className="input text-xs py-1 px-2 bg-gray-800">
            {stages.map((s, i) => (
              <option key={i} value={i}>{i + 1}. {s.label}</option>
            ))}
          </select>
        </div>

        {currentStage && (
          <div className="flex items-center gap-2 ml-auto">
            <span className={`text-xs px-2 py-0.5 rounded font-medium ${
              currentStage.type === 'print' ? 'bg-blue-900/60 text-blue-300' : 'bg-yellow-900/60 text-yellow-300'
            }`}>
              {currentStage.type === 'print' ? '🖨️ Printing' : '⚙️ Machining'}
            </span>
            <div className="w-32 h-1.5 bg-gray-700 rounded-full overflow-hidden">
              <div className="h-full bg-primary rounded-full transition-all" style={{ width: `${Math.round(stageProgress * 100)}%` }} />
            </div>
            <span className="text-xs text-gray-500">{Math.round(stageProgress * 100)}%</span>
          </div>
        )}
      </div>

      {/* Stage timeline */}
      <div className="flex gap-1 px-4 py-1.5 bg-gray-950 border-b border-gray-800 overflow-x-auto">
        {stages.map((s, i) => (
          <button key={i} onClick={() => jumpToStage(i)}
            className={`shrink-0 px-2 py-0.5 rounded text-[10px] transition ${
              i === stageIdx
                ? s.type === 'print' ? 'bg-blue-800 text-blue-200' : 'bg-yellow-800 text-yellow-200'
                : i < stageIdx ? 'bg-gray-800 text-gray-400' : 'bg-gray-900 text-gray-600 border border-gray-800'
            }`}
          >
            {s.type === 'print' ? '▣' : '⚙'} {s.label}
          </button>
        ))}
      </div>

      {/* 3D canvas */}
      <div ref={containerRef} className="flex-1 min-h-0" />

      {/* Legend + visibility toggles */}
      <div className="flex items-center gap-2 px-4 py-2 bg-gray-900 border-t border-gray-800 flex-wrap">
        <span className="text-[10px] text-gray-600 mr-1 shrink-0">Show/Hide:</span>
        <Toggle label="Part"        color="#2277dd" field="part"     />
        <Toggle label="Support"     color="#ff8800" field="support"  />
        <Toggle label="CNC Rapids"  color="#ffcc00" field="cncRapid" />
        <Toggle label="CNC Cuts"    color="#2288ff" field="cncCut"   />
        <Toggle label="Nozzle"      color="#ff8c00" field="nozzle"   />
        <Toggle label="CNC Tool"    color="#d8d8d8" field="tool"     />
        <span className="ml-auto text-[10px] text-gray-700 tabular-nums">
          LH {layerHeightMm}mm · Ø{nozzleDiameterMm}mm nozzle · Ø{toolDiameterMm}mm tool
        </span>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Main HybridPreview page
// ─────────────────────────────────────────────────────────────────────────────

export default function HybridPreview() {
  const { data: jobs     = [] } = useQuery({ queryKey: ['jobs'],          queryFn: jobsApi.getAll })
  const { data: profiles = [] } = useQuery({ queryKey: ['printProfiles'], queryFn: printProfilesApi.getAll })
  const { data: machines = [] } = useQuery({ queryKey: ['machines'],      queryFn: machineProfilesApi.getAll })
  const { data: gCodeBlocks = [] } = useQuery({ queryKey: ['gcode-blocks'], queryFn: customGCodeApi.getAll })

  const [jobId,          setJobId]          = useState('')
  const [simReady,       setSimReady]       = useState(false)
  const [printGCode,     setPrintGCode]     = useState<string | null>(null)
  const [cncGCode,       setCncGCode]       = useState<string | null>(null)
  const [machinedLayers, setMachinedLayers] = useState<number[]>([])
  const [loading,        setLoading]        = useState(false)
  const [error,          setError]          = useState<string | null>(null)

  const readyJobs    = jobs.filter(j => j.status === 'ToolpathsComplete' || j.status === 'Ready')
  const selectedJob  = jobs.find(j => j.id === jobId) as PrintJob | undefined
  const printProfile = profiles.find(p => p.id === selectedJob?.printProfileId)
  const machine      = machines.find(m => m.id === selectedJob?.machineProfileId)

  const layerHeightMm    = printProfile?.layerHeightMm ?? 0.2
  const nozzleDiameterMm = (printProfile?.nozzleDiameterMm && printProfile.nozzleDiameterMm > 0)
    ? printProfile.nozzleDiameterMm
    : (printProfile?.lineWidthMm ?? 0.4)
  const bedWidth  = machine?.bedWidthMm  ?? 300
  const bedDepth  = machine?.bedDepthMm  ?? 300

  const loadAndRun = async () => {
    if (!jobId) return
    setLoading(true); setError(null)
    try {
      const [pg, cg] = await Promise.all([
        jobsApi.getPrintGCode(jobId),
        jobsApi.getToolpathGCode(jobId),
      ])
      setPrintGCode(pg); setCncGCode(cg)
      const layers: number[] = []
      for (const line of cg.split('\n')) {
        const m = line.match(/^;.*Layer\s+(\d+)/i)
        if (m) {
          const n = parseInt(m[1])
          if (!isNaN(n) && !layers.includes(n)) layers.push(n)
        }
      }
      layers.sort((a, b) => a - b)
      setMachinedLayers(layers)
      setSimReady(true)
    } catch (e: unknown) {
      const err = e as { response?: { data?: { detail?: string } }; message?: string }
      setError(err?.response?.data?.detail ?? err?.message ?? 'Failed to load G-code')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="h-full flex flex-col space-y-0">
      {!simReady && (
        <div className="p-6 space-y-6">
          <h2 className="text-2xl font-semibold text-white">Hybrid Preview</h2>
          <p className="text-sm text-gray-400">
            Simulates the full hybrid process using the real print and CNC G-code files.
            Part and support material are coloured differently. Use the legend to show or hide layers.
          </p>
          <div className="max-w-lg space-y-4">
            <div className="space-y-1">
              <label className="text-sm text-gray-400">Select Job</label>
              <select className="input w-full" value={jobId} onChange={e => setJobId(e.target.value)}>
                <option value="">Choose a job with toolpaths…</option>
                {readyJobs.map(j => (
                  <option key={j.id} value={j.id}>
                    {j.name} ({j.status}) — {j.totalPrintLayers ?? '?'} layers
                  </option>
                ))}
              </select>
              {jobs.length > 0 && readyJobs.length === 0 && (
                <p className="text-xs text-yellow-500 mt-1">No jobs with toolpaths. Generate toolpaths in Hybrid Planner first.</p>
              )}
            </div>

            {selectedJob && (
              <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 space-y-2 text-sm">
                <div className="font-medium text-white">{selectedJob.name}</div>
                <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-xs text-gray-400">
                  <span>Status: <span className="text-gray-300">{selectedJob.status}</span></span>
                  <span>Layers: <span className="text-gray-300">{selectedJob.totalPrintLayers ?? '?'}</span></span>
                  <span>Layer height: <span className="text-gray-300">{layerHeightMm} mm</span></span>
                  <span>Nozzle: <span className="text-gray-300">Ø{nozzleDiameterMm} mm</span></span>
                  <span>Bed: <span className="text-gray-300">{bedWidth}×{bedDepth} mm</span></span>
                </div>
              </div>
            )}

            {selectedJob && (() => {
              const enabledCount = gCodeBlocks.filter(b => b.isEnabled).length
              return enabledCount > 0 ? (
                <div className="bg-blue-950/40 border border-blue-800 rounded-lg px-3 py-2 text-xs text-blue-300 flex items-center justify-between">
                  <span>{enabledCount} G-code customisation block{enabledCount !== 1 ? 's' : ''} enabled — will be included in hybrid output</span>
                  <Link to="/custom-gcode" className="text-blue-400 hover:text-blue-200 underline ml-2">Edit</Link>
                </div>
              ) : (
                <div className="flex items-center gap-2 text-xs text-gray-600">
                  <span>No G-code customisation blocks enabled.</span>
                  <Link to="/custom-gcode" className="text-gray-500 hover:text-gray-300 underline">Add G-code customisation</Link>
                </div>
              )
            })()}

            {error && (
              <div className="bg-red-950/40 border border-red-800 rounded-lg px-3 py-2 text-xs text-red-400">{error}</div>
            )}

            <DisabledHint when={!jobId} reason="Select a job with toolpaths above to run the simulation.">
              <button
                onClick={loadAndRun}
                disabled={!jobId || loading}
                className="px-6 py-2.5 bg-primary/80 hover:bg-primary disabled:opacity-40 text-white rounded-lg text-sm transition"
              >
                {loading ? 'Loading G-code…' : '▶ Run Hybrid Simulation'}
              </button>
            </DisabledHint>
          </div>
        </div>
      )}

      {simReady && printGCode && cncGCode && (
        <div className="flex flex-col h-screen">
          <div className="flex items-center gap-4 px-6 py-3 bg-gray-900 border-b border-gray-800">
            <h2 className="text-lg font-semibold text-white">Hybrid Preview</h2>
            <span className="text-sm text-gray-400">{selectedJob?.name}</span>
            <span className="text-xs text-gray-600">
              {machinedLayers.length} machining stages · {selectedJob?.totalPrintLayers ?? '?'} print layers
            </span>
            <Link
              to="/custom-gcode"
              className="ml-auto px-3 py-1 text-xs bg-blue-900/60 hover:bg-blue-800 text-blue-300 rounded-lg border border-blue-700 transition"
            >
              G-code Customisation
            </Link>
            <button
              onClick={() => { setSimReady(false); setPrintGCode(null); setCncGCode(null) }}
              className="px-3 py-1 text-xs bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-lg"
            >
              ← Back
            </button>
          </div>
          <div className="flex-1 min-h-0">
            <HybridSimViewer
              printGCode={printGCode}
              cncGCode={cncGCode}
              machinedLayers={machinedLayers}
              totalPrintLayers={selectedJob?.totalPrintLayers ?? 100}
              layerHeightMm={layerHeightMm}
              nozzleDiameterMm={nozzleDiameterMm}
              toolDiameterMm={3}
              bedWidth={bedWidth}
              bedDepth={bedDepth}
            />
          </div>
        </div>
      )}
    </div>
  )
}
