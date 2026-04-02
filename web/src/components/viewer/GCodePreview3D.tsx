import { useEffect, useRef, useState, useMemo } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import type { BuildVolume } from './StlViewer'

interface Props {
  gcode: string
  buildVolume: BuildVolume
  lineWidth?: number   // mm — defaults to 0.4 (nozzle diameter)
  className?: string
}

const MODEL_COLOR   = 0x1e40af   // blue — matches StlViewer model colour
const SUPPORT_COLOR = 0xf97316   // orange — clearly distinct from model
const BEAD_SEGS     = 6          // hexagonal cross-section

interface Segment {
  x0: number; y0: number; z0: number  // Three.js world coords (Y = gcode Z = height)
  x1: number; y1: number; z1: number
  isSupport: boolean
  gcodeZ: number  // midpoint gcode Z, used for height filtering
}

interface Parsed {
  segments: Segment[]
  maxGcodeZ: number
}

/**
 * Parse all extrusion moves (G1 with increasing E) into segments.
 * Tracks ;TYPE: comments to distinguish model vs support.
 *
 * Coordinate mapping (Three.js Y-up):
 *   G-code X → Three X
 *   G-code Y → Three Z  (depth)
 *   G-code Z → Three Y  (height above bed)
 */
function parseExtrusions(gcode: string): Parsed {
  const segments: Segment[] = []
  let x = 0, y = 0, z = 0, e = 0, hasPos = false
  let isSupport = false
  let maxGcodeZ = 0

  for (const raw of gcode.split('\n')) {
    const trimmed = raw.trim()

    if (trimmed.startsWith(';TYPE:')) {
      const type = trimmed.slice(6).trim().toUpperCase()
      isSupport = type.startsWith('SUPPORT')
      continue
    }

    const line = trimmed.split(';')[0].trim()
    if (!line) continue
    const up = line.toUpperCase()

    if (up.startsWith('G92')) {
      const m = up.match(/E([+-]?[\d.]+)/)
      if (m) e = parseFloat(m[1])
      continue
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
      segments.push({
        // Three.js: X=gcodeX, Y=gcodeZ (height), Z=gcodeY (depth)
        x0: x,  y0: z,  z0: y,
        x1: nx, y1: nz, z1: ny,
        isSupport,
        gcodeZ: midZ,
      })
    }

    x = nx; y = ny; z = nz; e = ne
    hasPos = true
  }

  return { segments, maxGcodeZ }
}

function buildMesh(
  segs: Segment[],
  geo: THREE.CylinderGeometry,
  mat: THREE.MeshPhongMaterial,
): THREE.InstancedMesh {
  const mesh  = new THREE.InstancedMesh(geo, mat, segs.length)
  mesh.frustumCulled = false
  const dummy = new THREE.Object3D()
  const yAxis = new THREE.Vector3(0, 1, 0)
  const dir   = new THREE.Vector3()

  for (let i = 0; i < segs.length; i++) {
    const { x0, y0, z0, x1, y1, z1 } = segs[i]
    const dx = x1-x0, dy = y1-y0, dz = z1-z0
    const len = Math.sqrt(dx*dx + dy*dy + dz*dz)
    dummy.position.set((x0+x1)/2, (y0+y1)/2, (z0+z1)/2)
    if (len > 0.001) {
      dir.set(dx, dy, dz).normalize()
      dummy.quaternion.setFromUnitVectors(yAxis, dir)
    } else {
      dummy.quaternion.identity()
    }
    dummy.scale.set(1, Math.max(len, 0.001), 1)
    dummy.updateMatrix()
    mesh.setMatrixAt(i, dummy.matrix)
  }
  mesh.instanceMatrix.needsUpdate = true
  return mesh
}

export default function GCodePreview3D({ gcode, buildVolume, lineWidth = 0.4, className }: Props) {
  const mountRef    = useRef<HTMLDivElement>(null)
  const [sliceH, setSliceH] = useState<number | null>(null)

  // Parse once per gcode change
  const parsed = useMemo(() => parseExtrusions(gcode), [gcode])

  // Reset slider to top whenever the gcode changes
  const prevGcode = useRef(gcode)
  if (prevGcode.current !== gcode) {
    prevGcode.current = gcode
    // Use a layout effect pattern: schedule a state update for next render
  }
  useEffect(() => {
    setSliceH(parsed.maxGcodeZ)
  }, [parsed.maxGcodeZ])

  // Filter segments by current slice height
  const { modelSegs, supportSegs, visBox } = useMemo(() => {
    const cutoff = sliceH ?? parsed.maxGcodeZ
    const modelSegs: Segment[]   = []
    const supportSegs: Segment[] = []
    const visBox = new THREE.Box3()

    for (const seg of parsed.segments) {
      if (seg.gcodeZ > cutoff) continue
      if (seg.isSupport) supportSegs.push(seg)
      else modelSegs.push(seg)
      visBox.expandByPoint(new THREE.Vector3(seg.x0, seg.y0, seg.z0))
      visBox.expandByPoint(new THREE.Vector3(seg.x1, seg.y1, seg.z1))
    }
    return { modelSegs, supportSegs, visBox }
  }, [parsed.segments, sliceH, parsed.maxGcodeZ])

  useEffect(() => {
    const el = mountRef.current
    if (!el || !gcode) return

    const w = Math.max(el.clientWidth, 1)
    const h = Math.max(el.clientHeight, 1)

    const renderer = new THREE.WebGLRenderer({ antialias: true })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.setSize(w, h)
    renderer.setClearColor(0x0d1117)
    el.appendChild(renderer.domElement)

    const scene = new THREE.Scene()
    scene.add(new THREE.AmbientLight(0xffffff, 0.5))
    const sun = new THREE.DirectionalLight(0xffffff, 1.0)
    sun.position.set(1, 2, 1.5)
    scene.add(sun)

    const camera   = new THREE.PerspectiveCamera(50, w / h, 0.1, 20000)
    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping  = true
    controls.dampingFactor  = 0.1

    const bw = buildVolume.width, bd = buildVolume.depth
    const cylGeo     = new THREE.CylinderGeometry(lineWidth / 2, lineWidth / 2, 1, BEAD_SEGS)
    const modelMat   = new THREE.MeshPhongMaterial({ color: MODEL_COLOR,   specular: 0x333333, shininess: 60 })
    const supportMat = new THREE.MeshPhongMaterial({ color: SUPPORT_COLOR, specular: 0x333333, shininess: 60 })

    if (modelSegs.length > 0)   scene.add(buildMesh(modelSegs,   cylGeo, modelMat))
    if (supportSegs.length > 0) scene.add(buildMesh(supportSegs, cylGeo, supportMat))

    // ── Bed outline (centred at origin for machine_center_is_zero=true) ──
    const hw = bw / 2, hd = bd / 2
    const bedPts = [
      new THREE.Vector3(-hw, 0, -hd), new THREE.Vector3( hw, 0, -hd),
      new THREE.Vector3( hw, 0, -hd), new THREE.Vector3( hw, 0,  hd),
      new THREE.Vector3( hw, 0,  hd), new THREE.Vector3(-hw, 0,  hd),
      new THREE.Vector3(-hw, 0,  hd), new THREE.Vector3(-hw, 0, -hd),
    ]
    const bedGeo = new THREE.BufferGeometry().setFromPoints(bedPts)
    scene.add(new THREE.LineSegments(bedGeo, new THREE.LineBasicMaterial({ color: 0x334155 })))

    // ── Camera framing ─────────────────────────────────────────────────
    const hasData = modelSegs.length + supportSegs.length > 0
    const center  = hasData ? visBox.getCenter(new THREE.Vector3()) : new THREE.Vector3(0, 0, 0)
    const span    = hasData ? visBox.getSize(new THREE.Vector3()) : new THREE.Vector3(bw, buildVolume.height, bd)
    const d = Math.max(span.x, span.y, span.z, bw, bd) * 1.5
    camera.position.set(center.x - d * 0.4, center.y + d * 0.8, center.z + d)
    camera.lookAt(center)
    controls.target.copy(center)
    controls.update()

    let animId: number
    const tick = () => { animId = requestAnimationFrame(tick); controls.update(); renderer.render(scene, camera) }
    tick()

    const ro = new ResizeObserver(() => {
      const nw = el.clientWidth, nh = el.clientHeight
      if (nw > 0 && nh > 0) { camera.aspect = nw / nh; camera.updateProjectionMatrix(); renderer.setSize(nw, nh) }
    })
    ro.observe(el)

    return () => {
      cancelAnimationFrame(animId)
      ro.disconnect()
      controls.dispose()
      cylGeo.dispose(); modelMat.dispose(); supportMat.dispose(); bedGeo.dispose()
      renderer.dispose()
      if (el.contains(renderer.domElement)) el.removeChild(renderer.domElement)
    }
  }, [modelSegs, supportSegs, visBox, buildVolume, lineWidth, gcode])

  const maxZ    = parsed.maxGcodeZ
  const current = sliceH ?? maxZ

  return (
    <div className={className} style={{ position: 'relative' }}>
      <div ref={mountRef} style={{ width: '100%', height: '100%' }} />

      {/* Layer height scroll bar — lets user cut away the top to see inside */}
      {maxZ > 0 && (
        <div
          style={{
            position: 'absolute', bottom: 12, left: 12, right: 12,
            display: 'flex', alignItems: 'center', gap: 8,
            background: 'rgba(13,17,23,0.75)', borderRadius: 8,
            padding: '6px 10px', backdropFilter: 'blur(4px)',
          }}
        >
          <span style={{ fontSize: 11, color: '#94a3b8', whiteSpace: 'nowrap', minWidth: 48 }}>
            {current.toFixed(1)} mm
          </span>
          <input
            type="range"
            min={0}
            max={maxZ}
            step={0.1}
            value={current}
            onChange={e => setSliceH(parseFloat(e.target.value))}
            style={{ flex: 1, cursor: 'pointer', accentColor: '#3b82f6' }}
          />
          <span style={{ fontSize: 11, color: '#64748b', whiteSpace: 'nowrap', minWidth: 48, textAlign: 'right' }}>
            {maxZ.toFixed(1)} mm
          </span>
        </div>
      )}
    </div>
  )
}
