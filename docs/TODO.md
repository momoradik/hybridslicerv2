# HybridSlicer — Implementation Roadmap

Status key: `[x]` Done  `[-]` In progress  `[ ]` Not started  `[!]` Blocked

---

## Phase 1 — Foundation (Weeks 1–2)

- [x] Solution structure and project references
- [x] Domain entities: MachineProfile, PrintProfile, CncTool, Material, PrintJob, HybridProcessPlan, ProcessStep, CustomGCodeBlock, BrandingSettings
- [x] Value objects: Coordinate3D, MachineOffset, LayerRange
- [x] Domain enums and exception hierarchy
- [x] Application layer: ISlicingEngine, IToolpathPlanner, ISafetyValidator, IHybridOrchestrator, IMachineDriver
- [x] Repository interfaces
- [x] EF Core AppDbContext with full model configuration
- [x] Infrastructure service registration (ServiceExtensions)
- [x] StorageOptions configuration pattern
- [x] GlobalExceptionMiddleware (domain → HTTP status mapping)
- [x] Serilog structured logging setup
- [x] API: Program.cs with auto-migrate + seed on startup
- [x] DbSeeder: default materials, machine profile, print profiles, tools, branding
- [ ] EF Core initial migration committed to repo
- [ ] Integration test: API starts, migrates, seeds without error

---

## Phase 2 — Core CRUD (Week 3)

- [x] MachineProfilesController (GET, POST, PUT offsets, DELETE)
- [x] PrintProfilesController (GET, POST, PUT, DELETE)
- [x] MaterialsController (GET, POST, DELETE)
- [x] ToolsController (GET, POST, PUT, DELETE)
- [x] CustomGCodeController (GET, POST, PUT, PATCH toggle, DELETE)
- [x] BrandingController (GET, PUT)
- [x] HybridPlansController (read-only views)
- [ ] FluentValidation validators for all request DTOs
- [ ] Controller integration tests (TestServer / WebApplicationFactory)
- [ ] Pagination on list endpoints (limit/offset query params)
- [ ] Soft-delete filter confirmed working on all applicable entities

---

## Phase 3 — STL Import and Preview (Week 4)

- [x] ImportStlHandler with file size + header validation
- [x] JobsController: upload-stl multipart endpoint
- [x] React STL drag-and-drop import page
- [x] Three.js STL viewer (binary + ASCII, OrbitControls, grid)
- [ ] Configurable model color / material preview in viewer
- [ ] Layer-slice preview: show horizontal cross-section at draggable Z
- [ ] STL bounding box displayed in UI (X × Y × Z mm)
- [ ] Non-manifold STL detection and user-friendly error message

---

## Phase 4 — Slicing (Week 5)

- [x] CuraEngineAdapter: subprocess invocation, config JSON generation, output parsing
- [x] SlicePrintJobHandler: profile → parameters → CuraEngine → job update
- [x] JobsController: POST /jobs/{id}/slice
- [x] Layer count + time estimate displayed in UI after slice
- [ ] Async slicing with SignalR progress streaming (replace synchronous wait)
- [ ] Slice cancellation support (CancellationToken propagation to subprocess kill)
- [ ] CuraEngine error messages surfaced to UI with clear instructions
- [ ] Smoke test: known STL + profile → layer count matches reference

---

## Phase 5 — CNC Toolpath (Week 6)

- [x] ContourToolpathPlanner: binary STL cross-section, convex-hull polygon, NetTopologySuite buffer, G-code emission
- [x] GenerateToolpathsHandler: per-layer planning loop with safety validation
- [x] JobsController: POST /jobs/{id}/generate-toolpaths
- [ ] Replace convex-hull approximation with proper segment-chain polygon extraction
- [ ] Support multiple passes per layer (roughing + finishing)
- [ ] Ramp plunge (helical entry) instead of direct plunge
- [ ] Feed/speed override per material type
- [ ] Toolpath preview in the UI (SVG or Three.js layer overlay)
- [ ] Unit test: known STL cross-section → expected polygon outline

---

## Phase 6 — Safety System (Week 7)

- [x] CollisionSafetyValidator: axis envelope, rapid clearance, AABB printed-geometry check
- [x] SafetyStatus enum: Unvalidated / Clear / Warning / Blocked
- [x] SafetyException (hard stop, cannot be bypassed)
- [x] Safety validator unit tests (all branches covered)
- [ ] **BVH mesh intersection** to replace AABB approximation for production accuracy
- [ ] Safety result displayed per-step in Hybrid Planner UI
- [ ] Operator "confirm warning" flow in UI before plan execution
- [ ] Feed rate clamping to tool's RecommendedFeedMmPerMin
- [ ] Maximum depth-of-cut validation against tool MaxDepthOfCutMm

---

## Phase 7 — Hybrid Orchestration (Week 8)

- [x] HybridOrchestrator: layer segmentation, machining injection, custom block injection
- [x] Layer-correct flushing: layer N printed before CNC at layer N
- [x] PlanHybridProcessHandler: full pipeline orchestration
- [x] JobsController: POST /jobs/{id}/plan-hybrid, GET /jobs/{id}/gcode
- [x] HybridPlanner UI page with process preview and download
- [ ] Step-level G-code preview panel in UI
- [ ] Re-plan without re-slicing (cache print G-code segments)
- [ ] Estimate total job time (print time + N × machining time)
- [ ] Hybrid G-code syntax highlighter in UI

---

## Phase 8 — Custom G-code Blocks (Week 8)

- [x] CustomGCodeBlock entity with trigger types
- [x] CustomGCodeController CRUD + toggle
- [x] Orchestrator injects enabled blocks at correct trigger points
- [x] Custom G-code editor page with trigger assignment
- [ ] G-code syntax validation (reject obviously malformed lines)
- [ ] Variables in custom blocks: `{LAYER}`, `{Z_HEIGHT}`, `{TOOL_NAME}`
- [ ] Import/export custom block library as JSON file
- [ ] Per-job block override (global vs. job-specific blocks)

---

## Phase 9 — Machine Communication (Week 9)

- [x] TcpMachineDriver: connect, send, ok-flow-control, IAsyncEnumerable streaming
- [x] MachineHub: SignalR hub for Connect/Disconnect/SendManualCommand/StreamJob
- [x] Calibration page: connect, disconnect, manual command, quick commands
- [x] useMachineConnection hook with auto-reconnect
- [ ] Serial port driver (System.IO.Ports) as alternative to TCP
- [ ] Grbl firmware driver (% acknowledgement + ? status query)
- [ ] Machine status dashboard: real-time temp, position, feed-rate
- [ ] Job pause/resume/emergency-stop via SignalR
- [ ] Reconnection recovery: replay last N lines on reconnect

---

## Phase 10 — UI Polish (Weeks 10–11)

- [x] Sidebar navigation with active-state highlighting
- [x] Header with live machine connection indicator and temperatures
- [x] Branding page with color pickers and live preview
- [x] White-label CSS variable system (useBranding hook)
- [ ] Dark/light theme toggle
- [ ] Responsive layout (tablet minimum)
- [ ] Loading skeletons on all data-fetching views
- [ ] Global toast notification system (success/error/warning)
- [ ] Keyboard shortcuts (Ctrl+N new job, Ctrl+S save profile, etc.)
- [ ] Onboarding wizard (first run: set CuraEngine path, create machine profile)

---

## Phase 11 — Testing and Quality (Weeks 11–12)

- [x] Domain unit tests: PrintJob state machine, CncTool, MachineProfile, HybridProcessPlan
- [x] Safety validator unit tests: all branches, multiple violations
- [x] Hybrid orchestrator integration test: layer ordering, block injection
- [ ] Controller integration tests (WebApplicationFactory, in-memory SQLite)
- [ ] CuraEngineAdapter integration test against real binary (CI-optional)
- [ ] End-to-end test: import STL → slice → toolpath → plan → download G-code
- [ ] Mutation testing (Stryker.NET) on safety validator
- [ ] Load test: 10 concurrent slice requests
- [ ] Frontend unit tests (Vitest + Testing Library): STL viewer mount, API hooks

---

## Phase 12 — Packaging (Week 12)

- [ ] Production `appsettings.Production.json` template
- [ ] `docker-compose.yml` for containerised deployment (API + Postgres)
- [ ] Electron wrapper for desktop installer (optional)
- [ ] Windows installer (Inno Setup or WiX) with CuraEngine bundled
- [ ] Auto-update mechanism
- [ ] Crash reporting (Sentry or equivalent)

---

## Deferred / Nice-to-Have

- [ ] Multi-extruder support (dual material, soluble support)
- [ ] 3-D simultaneous CNC (5-axis) toolpath planner
- [ ] G-code simulation (animate toolpath in viewer before execution)
- [ ] Cloud job history and remote monitoring
- [ ] Plugin API: third-party slicer or machine driver adapters
- [ ] Material cost and print time quoting
- [ ] QR-code traceability: link physical part to job record
- [ ] OPC-UA machine interface (industrial PLC integration)
