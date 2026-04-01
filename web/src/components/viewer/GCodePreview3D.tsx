import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import type { BuildVolume } from './StlViewer'

interface Props {
  gcode: string
  buildVolume: BuildVolume
  lineWidth?: number   // mm — defaults to 0.4 (nozzle diameter)
  className?: string
}

// Matches C_NORMAL in StlViewer so the preview uses the same colour as the model
const MODEL_COLOR   = 0x1e40af   // blue
const SUPPORT_COLOR = 0xf97316   // orange — clearly distinct from model
const BEAD_SEGS     = 6          // hexagonal cross-section

/**
 * Parse all extrusion moves (G1 with increasing E) into two Float32Arrays:
 *   - model:   all non-support features (walls, infill, skin, …)
 *   - support: segments where ;TYPE:SUPPORT or ;TYPE:SUPPORT-INTERFACE is active
 *
 * Coordinate mapping (Three.js Y-up):
 *   G-code X → Three X
 *   G-code Y → Three Z  (depth)
 *   G-code Z → Three Y  (height above bed)
 */
function parseExtrusions(gcode: string): {
  model:   Float32Array
  support: Float32Array
  box:     THREE.Box3
} {
  const modelTmp:   number[] = []
  const supportTmp: number[] = []

  let x = 0, y = 0, z = 0, e = 0, hasPos = false
  let isSupport = false
  const box = new THREE.Box3()
  const p0  = new THREE.Vector3()
  const p1  = new THREE.Vector3()

  for (const raw of gcode.split('\n')) {
    const trimmed = raw.trim()

    // Track ;TYPE: comment lines (keep raw line for comment scanning)
    if (trimmed.startsWith(';TYPE:')) {
      const type = trimmed.slice(6).trim().toUpperCase()
      isSupport = type === 'SUPPORT' || type === 'SUPPORT-INTERFACE' || type.startsWith('SUPPORT')
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
      // Map: gcode(X,Y,Z) → three(X, gcodeZ, gcodeY)
      const seg = [x, z, y, nx, nz, ny]
      if (isSupport) {
        supportTmp.push(...seg)
      } else {
        modelTmp.push(...seg)
      }
      p0.set(x, z, y); p1.set(nx, nz, ny)
      box.expandByPoint(p0)
      box.expandByPoint(p1)
    }

    x = nx; y = ny; z = nz; e = ne
    hasPos = true
  }

  return {
    model:   new Float32Array(modelTmp),
    support: new Float32Array(supportTmp),
    box,
  }
}

function buildInstancedMesh(
  buf: Float32Array,
  geo: THREE.CylinderGeometry,
  mat: THREE.MeshPhongMaterial,
): THREE.InstancedMesh {
  const segCount = buf.length / 6
  const mesh  = new THREE.InstancedMesh(geo, mat, segCount)
  mesh.frustumCulled = false

  const dummy = new THREE.Object3D()
  const yAxis = new THREE.Vector3(0, 1, 0)
  const dir   = new THREE.Vector3()

  for (let i = 0; i < segCount; i++) {
    const b  = i * 6
    const x0 = buf[b],   y0 = buf[b+1], z0 = buf[b+2]
    const x1 = buf[b+3], y1 = buf[b+4], z1 = buf[b+5]
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
  const mountRef = useRef<HTMLDivElement>(null)

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

    const camera = new THREE.PerspectiveCamera(50, w / h, 0.1, 20000)
    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping = true
    controls.dampingFactor = 0.1

    const { model, support, box } = parseExtrusions(gcode)
    const bw = buildVolume.width
    const bd = buildVolume.depth

    // ── Shared cylinder geometry (unit height, radius = lineWidth/2) ─────────
    const cylGeo     = new THREE.CylinderGeometry(lineWidth / 2, lineWidth / 2, 1, BEAD_SEGS)
    const modelMat   = new THREE.MeshPhongMaterial({ color: MODEL_COLOR,   specular: 0x333333, shininess: 60 })
    const supportMat = new THREE.MeshPhongMaterial({ color: SUPPORT_COLOR, specular: 0x333333, shininess: 60 })

    if (model.length > 0) {
      scene.add(buildInstancedMesh(model, cylGeo, modelMat))
    }
    if (support.length > 0) {
      scene.add(buildInstancedMesh(support, cylGeo, supportMat))
    }

    // ── Bed outline ────────────────────────────────────────────────────────
    // CuraEngine is invoked with machine_center_is_zero=true, so G-code
    // coordinates run from -width/2 to +width/2 (same as the STL viewer).
    const hw = bw / 2, hd = bd / 2
    const bedPts = [
      new THREE.Vector3(-hw, 0, -hd), new THREE.Vector3( hw, 0, -hd),
      new THREE.Vector3( hw, 0, -hd), new THREE.Vector3( hw, 0,  hd),
      new THREE.Vector3( hw, 0,  hd), new THREE.Vector3(-hw, 0,  hd),
      new THREE.Vector3(-hw, 0,  hd), new THREE.Vector3(-hw, 0, -hd),
    ]
    const bedGeo = new THREE.BufferGeometry().setFromPoints(bedPts)
    scene.add(new THREE.LineSegments(bedGeo, new THREE.LineBasicMaterial({ color: 0x334155 })))

    // ── Camera framing ─────────────────────────────────────────────────────
    const hasData = model.length > 0 || support.length > 0
    const center  = hasData ? box.getCenter(new THREE.Vector3()) : new THREE.Vector3(0, 0, 0)
    const span    = hasData ? box.getSize(new THREE.Vector3()) : new THREE.Vector3(bw, buildVolume.height, bd)

    const d = Math.max(span.x, span.y, span.z, bw, bd) * 1.5
    camera.position.set(center.x - d * 0.4, center.y + d * 0.8, center.z + d)
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

    // ── Resize ─────────────────────────────────────────────────────────────
    const ro = new ResizeObserver(() => {
      const nw = el.clientWidth, nh = el.clientHeight
      if (nw > 0 && nh > 0) {
        camera.aspect = nw / nh
        camera.updateProjectionMatrix()
        renderer.setSize(nw, nh)
      }
    })
    ro.observe(el)

    return () => {
      cancelAnimationFrame(animId)
      ro.disconnect()
      controls.dispose()
      cylGeo.dispose()
      modelMat.dispose()
      supportMat.dispose()
      bedGeo.dispose()
      renderer.dispose()
      if (el.contains(renderer.domElement)) el.removeChild(renderer.domElement)
    }
  }, [gcode, buildVolume, lineWidth])

  return <div ref={mountRef} className={className} />
}
