import { useEffect, useRef, useState, useMemo } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import type { BuildVolume } from './StlViewer'

interface Props {
  gcode: string
  buildVolume: BuildVolume
  lineWidth?: number
  className?: string
}

const MODEL_COLOR   = 0x1e40af
const SUPPORT_COLOR = 0xf97316
const BEAD_SEGS     = 6

interface Segment {
  x0: number; y0: number; z0: number
  x1: number; y1: number; z1: number
  isSupport: boolean
  gcodeZ: number   // gcode Z (= Three.js Y) of segment midpoint, for height filtering
}

function parseGCode(gcode: string): { segments: Segment[]; maxGcodeZ: number } {
  const segments: Segment[] = []
  let x = 0, y = 0, z = 0, e = 0, hasPos = false
  let isSupport = false
  let maxGcodeZ = 0

  for (const raw of gcode.split('\n')) {
    const trimmed = raw.trim()
    if (trimmed.startsWith(';TYPE:')) {
      isSupport = trimmed.slice(6).trim().toUpperCase().startsWith('SUPPORT')
      continue
    }
    const line = trimmed.split(';')[0].trim()
    if (!line) continue
    const up = line.toUpperCase()

    if (up.startsWith('G92')) {
      const m = up.match(/E([+-]?[\d.]+)/); if (m) e = parseFloat(m[1]); continue
    }
    if (!up.startsWith('G0') && !up.startsWith('G1')) continue

    const xm = up.match(/X([+-]?[\d.]+)/)
    const ym = up.match(/Y([+-]?[\d.]+)/)
    const zm = up.match(/Z([+-]?[\d.]+)/)
    const em = up.match(/E([+-]?[\d.]+)/)

    const nx = xm ? parseFloat(xm[1]) : x
    const ny = ym ? parseFloat(ym[1]) : y
    const nz = zm ? parseFloat(zm[1]) : z
    const ne = em ? parseFloat(em[1]) : e

    if (hasPos && em && ne > e) {
      const midZ = (z + nz) / 2
      if (midZ > maxGcodeZ) maxGcodeZ = midZ
      // Three.js: X=gcodeX, Y=gcodeZ(height), Z=gcodeY(depth)
      segments.push({ x0: x, y0: z, z0: y, x1: nx, y1: nz, z1: ny, isSupport, gcodeZ: midZ })
    }
    x = nx; y = ny; z = nz; e = ne; hasPos = true
  }
  return { segments, maxGcodeZ }
}

function makeMesh(
  segs: Segment[],
  cylGeo: THREE.CylinderGeometry,
  color: number,
): THREE.InstancedMesh {
  const mat  = new THREE.MeshPhongMaterial({ color, specular: 0x333333, shininess: 60 })
  const mesh = new THREE.InstancedMesh(cylGeo, mat, segs.length)
  mesh.frustumCulled = false

  const dummy = new THREE.Object3D()
  const yAxis = new THREE.Vector3(0, 1, 0)
  const dir   = new THREE.Vector3()

  for (let i = 0; i < segs.length; i++) {
    const { x0, y0, z0, x1, y1, z1 } = segs[i]
    const dx = x1-x0, dy = y1-y0, dz = z1-z0
    const len = Math.sqrt(dx*dx + dy*dy + dz*dz)
    dummy.position.set((x0+x1)/2, (y0+y1)/2, (z0+z1)/2)
    if (len > 0.001) { dir.set(dx, dy, dz).normalize(); dummy.quaternion.setFromUnitVectors(yAxis, dir) }
    else dummy.quaternion.identity()
    dummy.scale.set(1, Math.max(len, 0.001), 1)
    dummy.updateMatrix()
    mesh.setMatrixAt(i, dummy.matrix)
  }
  mesh.instanceMatrix.needsUpdate = true
  return mesh
}

export default function GCodePreview3D({ gcode, buildVolume, lineWidth = 0.4, className }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mountRef     = useRef<HTMLDivElement>(null)

  // Parsed data (only recomputed when gcode changes)
  const parsed = useMemo(() => parseGCode(gcode), [gcode])

  // Slider state — initialised / reset to top when gcode changes
  const [sliceH, setSliceH] = useState(parsed.maxGcodeZ)
  const prevGcodeRef = useRef(gcode)
  if (prevGcodeRef.current !== gcode) {
    prevGcodeRef.current = gcode
    setSliceH(parsed.maxGcodeZ)   // synchronous reset before render
  }

  // ── Stable Three.js scene (renderer, camera, controls, lights, bed) ────────
  // This effect only runs when gcode / buildVolume / lineWidth change.
  // It stores mutable scene state in refs so the slider effect can touch meshes
  // without rebuilding the whole scene.
  const sceneRef    = useRef<THREE.Scene | null>(null)
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null)
  const cameraRef   = useRef<THREE.PerspectiveCamera | null>(null)
  const controlsRef = useRef<OrbitControls | null>(null)
  const modelMeshRef   = useRef<THREE.InstancedMesh | null>(null)
  const supportMeshRef = useRef<THREE.InstancedMesh | null>(null)
  const cylGeoRef   = useRef<THREE.CylinderGeometry | null>(null)
  // Segments sorted by gcodeZ — used to binary-search the cutoff index
  const modelSortedRef   = useRef<Segment[]>([])
  const supportSortedRef = useRef<Segment[]>([])

  useEffect(() => {
    const el = mountRef.current
    if (!el) return

    // ── Tear down any previous scene ──────────────────────────────────────
    controlsRef.current?.dispose()
    rendererRef.current?.dispose()
    if (rendererRef.current && el.contains(rendererRef.current.domElement))
      el.removeChild(rendererRef.current.domElement)

    const w = Math.max(el.clientWidth, 1)
    const h = Math.max(el.clientHeight, 1)

    const renderer = new THREE.WebGLRenderer({ antialias: true })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.setSize(w, h)
    renderer.setClearColor(0x0d1117)
    el.appendChild(renderer.domElement)
    rendererRef.current = renderer

    const scene = new THREE.Scene()
    scene.add(new THREE.AmbientLight(0xffffff, 0.5))
    const sun = new THREE.DirectionalLight(0xffffff, 1.0)
    sun.position.set(1, 2, 1.5)
    scene.add(sun)
    sceneRef.current = scene

    const camera = new THREE.PerspectiveCamera(50, w / h, 0.1, 20000)
    cameraRef.current = camera

    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping = true
    controls.dampingFactor = 0.1
    controlsRef.current = controls

    // ── Bed outline ───────────────────────────────────────────────────────
    const bw = buildVolume.width, bd = buildVolume.depth
    const hw = bw / 2, hd = bd / 2
    const bedPts = [
      new THREE.Vector3(-hw,0,-hd), new THREE.Vector3(hw,0,-hd),
      new THREE.Vector3(hw,0,-hd),  new THREE.Vector3(hw,0,hd),
      new THREE.Vector3(hw,0,hd),   new THREE.Vector3(-hw,0,hd),
      new THREE.Vector3(-hw,0,hd),  new THREE.Vector3(-hw,0,-hd),
    ]
    const bedGeo = new THREE.BufferGeometry().setFromPoints(bedPts)
    scene.add(new THREE.LineSegments(bedGeo, new THREE.LineBasicMaterial({ color: 0x334155 })))

    // ── Build meshes for ALL segments ─────────────────────────────────────
    const cylGeo = new THREE.CylinderGeometry(lineWidth / 2, lineWidth / 2, 1, BEAD_SEGS)
    cylGeoRef.current = cylGeo

    const modelSegs   = parsed.segments.filter(s => !s.isSupport)
    const supportSegs = parsed.segments.filter(s =>  s.isSupport)

    // Sort by gcodeZ for binary-search slicing
    const byZ = (a: Segment, b: Segment) => a.gcodeZ - b.gcodeZ
    modelSortedRef.current   = [...modelSegs].sort(byZ)
    supportSortedRef.current = [...supportSegs].sort(byZ)

    const modelMesh   = makeMesh(modelSortedRef.current,   cylGeo, MODEL_COLOR)
    const supportMesh = makeMesh(supportSortedRef.current, cylGeo, SUPPORT_COLOR)
    scene.add(modelMesh)
    scene.add(supportMesh)
    modelMeshRef.current   = modelMesh
    supportMeshRef.current = supportMesh

    // ── Frame camera on full model ─────────────────────────────────────────
    const box = new THREE.Box3()
    for (const s of parsed.segments) {
      box.expandByPoint(new THREE.Vector3(s.x0, s.y0, s.z0))
      box.expandByPoint(new THREE.Vector3(s.x1, s.y1, s.z1))
    }
    const hasData = parsed.segments.length > 0
    const center  = hasData ? box.getCenter(new THREE.Vector3()) : new THREE.Vector3(0, 0, 0)
    const span    = hasData ? box.getSize(new THREE.Vector3()) : new THREE.Vector3(bw, buildVolume.height, bd)
    const d = Math.max(span.x, span.y, span.z, bw, bd) * 1.5
    camera.position.set(center.x - d * 0.4, center.y + d * 0.8, center.z + d)
    camera.lookAt(center)
    controls.target.copy(center)
    controls.update()

    // ── Render loop ────────────────────────────────────────────────────────
    let animId: number
    const tick = () => { animId = requestAnimationFrame(tick); controls.update(); renderer.render(scene, camera) }
    tick()

    // ── Resize ────────────────────────────────────────────────────────────
    const ro = new ResizeObserver(() => {
      const nw = el.clientWidth, nh = el.clientHeight
      if (nw > 0 && nh > 0) { camera.aspect = nw / nh; camera.updateProjectionMatrix(); renderer.setSize(nw, nh) }
    })
    ro.observe(el)

    return () => {
      cancelAnimationFrame(animId)
      ro.disconnect()
      controls.dispose()
      cylGeo.dispose()
      modelMesh.material instanceof THREE.Material && modelMesh.material.dispose()
      supportMesh.material instanceof THREE.Material && supportMesh.material.dispose()
      bedGeo.dispose()
      renderer.dispose()
      if (el.contains(renderer.domElement)) el.removeChild(renderer.domElement)
      sceneRef.current    = null
      rendererRef.current = null
      cameraRef.current   = null
      controlsRef.current = null
      modelMeshRef.current   = null
      supportMeshRef.current = null
    }
  }, [gcode, buildVolume, lineWidth, parsed])   // rebuild scene only when source data changes

  // ── Slider effect — only updates mesh.count, never rebuilds scene ──────────
  useEffect(() => {
    const cutoff = sliceH
    // Binary search: count of segments with gcodeZ <= cutoff
    const countBelow = (segs: Segment[]) => {
      let lo = 0, hi = segs.length
      while (lo < hi) {
        const mid = (lo + hi) >> 1
        if (segs[mid].gcodeZ <= cutoff) lo = mid + 1; else hi = mid
      }
      return lo
    }
    if (modelMeshRef.current)   modelMeshRef.current.count   = countBelow(modelSortedRef.current)
    if (supportMeshRef.current) supportMeshRef.current.count = countBelow(supportSortedRef.current)
  }, [sliceH])

  const maxZ    = parsed.maxGcodeZ
  const current = sliceH

  return (
    <div ref={containerRef} className={className} style={{ position: 'relative' }}>
      <div ref={mountRef} style={{ width: '100%', height: '100%' }} />

      {maxZ > 0 && (
        <div style={{
          position: 'absolute', bottom: 12, left: 12, right: 12,
          display: 'flex', alignItems: 'center', gap: 8,
          background: 'rgba(13,17,23,0.80)', borderRadius: 8,
          padding: '6px 10px', backdropFilter: 'blur(4px)',
        }}>
          <span style={{ fontSize: 11, color: '#94a3b8', whiteSpace: 'nowrap', minWidth: 52 }}>
            {current.toFixed(1)} mm
          </span>
          <input
            type="range" min={0} max={maxZ} step={0.1} value={current}
            onChange={e => setSliceH(parseFloat(e.target.value))}
            style={{ flex: 1, cursor: 'pointer', accentColor: '#3b82f6' }}
          />
          <span style={{ fontSize: 11, color: '#64748b', whiteSpace: 'nowrap', minWidth: 52, textAlign: 'right' }}>
            {maxZ.toFixed(1)} mm
          </span>
        </div>
      )}
    </div>
  )
}
