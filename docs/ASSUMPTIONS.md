# Assumptions

This document records every assumption made during the design and implementation of HybridSlicer.
Each assumption should be validated against reality before production deployment.

---

## Machine and Hardware

| ID | Assumption | Risk if wrong | Mitigation |
|----|------------|--------------|------------|
| H-1 | The CNC spindle and 3D printer are on the **same physical machine** and share a coordinate origin (with a configurable X/Y offset). | If they are separate machines, toolpath coordinates must be transformed between coordinate frames. | `MachineOffset` value object is designed for this; a second machine profile can represent the CNC machine independently. |
| H-2 | Machine communication uses **TCP/IP** over a local network (Marlin-compatible protocol). | Serial (USB) connections require a different driver. | `IMachineDriver` is an interface; a `SerialMachineDriver` can be added without changing any other code. |
| H-3 | The machine firmware acknowledges every G-code line with `ok` before the next line is sent (standard Marlin flow control). | Grbl and some RepRap variants use different acknowledgement protocols. | A `GrblMachineDriver` implementation can be added; the TCP driver is isolated behind `IMachineDriver`. |
| H-4 | The print bed is **level and calibrated** before any job. HybridSlicer does not perform auto-levelling. | Unlevelled bed → first layer adhesion failure → job ruined. | Calibration page allows manual jog and probe sequences; auto-level routine can be added as a custom G-code block (e.g., `G29`). |

---

## Geometry and Toolpath

| ID | Assumption | Risk if wrong | Mitigation |
|----|------------|--------------|------------|
| G-1 | CNC operations are **2.5-D contour milling** (constant Z per pass). Full 3-D simultaneous machining is out of scope for Phase 1. | Complex organic geometries may require 3-D toolpaths. | `IToolpathPlanner` is an interface; a 3-D planner can be substituted without changing the orchestration layer. |
| G-2 | The STL file represents a **manifold, water-tight solid**. Non-manifold meshes may produce incorrect layer cross-sections. | Non-manifold STL → empty or incorrect toolpaths. | STL header validation is performed on import; full mesh repair (ADMesh / Netfabb) can be added to the import pipeline. |
| G-3 | The convex hull of layer cross-section intersection points is an acceptable approximation of the true cross-section polygon for Phase 1. | Non-convex cross-sections (L-shapes, H-shapes) will be approximated as their convex hull, removing interior details from the toolpath. | Phase 2 will replace the convex-hull fallback with proper segment chaining using `NetTopologySuite.Triangulate` or a custom segment-graph algorithm. |
| G-4 | Cutter-radius compensation is applied as an **outward polygon buffer** (tool stays outside the nominal boundary). Inward compensation (climb vs. conventional) is toggled by the `ClimbMilling` flag. | Wrong compensation direction → tool gouges the part. | `ClimbMilling = true` by default; safety validator checks engagement against printed geometry. |

---

## Slicing

| ID | Assumption | Risk if wrong | Mitigation |
|----|------------|--------------|------------|
| S-1 | CuraEngine is installed separately and available on the host system. It is **not bundled** with HybridSlicer. | If CuraEngine is absent, the slice step fails with a clear error. | `CuraEngineAdapter` checks for the binary before invoking it and throws `SlicingException` with actionable message. |
| S-2 | CuraEngine writes **`;LAYER:N`** comments (1-based) into the G-code output. HybridSlicer's orchestrator relies on these to segment the print G-code by layer. | Some CuraEngine versions write `;LAYER:0` (0-based). | `SplitByLayer` uses a regex and stores by the integer value; offset can be adjusted if needed. |
| S-3 | CuraEngine's config JSON schema is **stable across patch versions** of CuraEngine 5.x. | Major CuraEngine upgrades may rename or remove setting keys. | The `CuraEngineAdapter` is isolated; a `CuraEngine4Adapter` can be added behind `ISlicingEngine` for older versions. |

---

## Database and Storage

| ID | Assumption | Risk if wrong | Mitigation |
|----|------------|--------------|------------|
| D-1 | **SQLite** is sufficient for single-user desktop deployments. Multi-user enterprise deployments should switch to PostgreSQL. | SQLite write-lock contention under concurrent requests. | `AddInfrastructure()` reads the connection string from config; swapping to PostgreSQL requires only a connection string change and `UseSqlite → UseNpgsql`. |
| D-2 | G-code files are stored as **files on disk** (not BLOBs in the database) because they can be hundreds of megabytes. | File system and DB can drift out of sync if files are deleted externally. | `PrintJob.StlFilePath`, `.PrintGCodePath`, `.HybridGCodePath` store paths; a periodic reconciliation task can be added. |
| D-3 | The `Storage:Root` directory is **writable** by the process. | Permission errors → import fails at directory creation. | `AddInfrastructure()` calls `Directory.CreateDirectory()` on startup; errors surface immediately. |

---

## Safety

| ID | Assumption | Risk if wrong | Mitigation |
|----|------------|--------------|------------|
| SF-1 | The collision check AABB approach (Phase 1) is **conservative** — it may produce false-positive warnings but will never allow a known collision through. | Over-conservative → more operator warnings than necessary. | Phase 2 replaces AABB with a BVH mesh intersection check for higher precision. |
| SF-2 | `SafetyStatus.Blocked` is a **hard stop** — the application will never execute a blocked toolpath. This is enforced at the domain level, not just the API. | A bug in the API layer could bypass the check. | `SafetyException` (a domain exception) is thrown; `GlobalExceptionMiddleware` maps it to HTTP 422. No path exists to execute without validation evidence. |
| SF-3 | The **safe clearance height** is measured from the current Z origin (machine home), not from the top of the print. | If machine home drifts or is set incorrectly, rapids may collide with the part. | The clearance height is configurable per machine profile; recommended value is at least `partHeight + 5 mm`. |

---

## UI and Branding

| ID | Assumption | Risk if wrong | Mitigation |
|----|------------|--------------|------------|
| U-1 | The React SPA runs in a **modern evergreen browser** (Chrome 110+, Edge 110+, Firefox 115+). IE11 is not supported. | Older browsers may not support `import.meta`, ES2020 syntax, or CSS custom properties. | Vite's build target can be lowered; add `@vitejs/plugin-legacy` for IE11 if required. |
| U-2 | Three.js GPU rendering is available on the host (WebGL 2). | Headless or very old GPU → Three.js falls back to software rendering, which is slow. | The STL viewer degrades gracefully; a fallback "no preview" state is shown if WebGL is unavailable. |
