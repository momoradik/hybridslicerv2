# ADR-001 — Technology Stack Selection

**Date:** 2026-03-09
**Status:** Accepted
**Deciders:** Architecture team

---

## Context

We need a full-stack platform for hybrid additive/subtractive manufacturing. The system requires:
- A desktop-capable or browser-based UI with real-time 3-D model preview
- A backend that can call external CLI tools (CuraEngine), open TCP sockets to machines, and manage a local database
- A modular, maintainable architecture that one or two developers can extend over time

Several options were evaluated.

---

## Decision

**Backend: C# / .NET 8 with ASP.NET Core**

**Frontend: React 18 + TypeScript + Three.js**

**Database: SQLite (dev/desktop) / PostgreSQL (production/enterprise)**

---

## Alternatives Considered

### Backend

| Option | Pros | Cons | Decision |
|---|---|---|---|
| **C# / .NET 8** | Strong typing, excellent async, EF Core, SignalR, Microsoft support | Verbose compared to Python | **Chosen** |
| Python (FastAPI) | Rapid prototyping, rich scientific libs | No native SignalR, weaker typing, slower for CPU-bound work | Rejected |
| Go | Fast, small binary | Small ecosystem for manufacturing libs, no EF equivalent | Rejected |
| Node.js | Same language as frontend | Callback complexity, weak typing at scale | Rejected |

### Frontend

| Option | Pros | Cons | Decision |
|---|---|---|---|
| **React 18 + Three.js** | Massive ecosystem, excellent 3-D via Three.js, strong TypeScript support | Learning curve for Three.js internals | **Chosen** |
| Vue 3 | Gentler learning curve | Smaller ecosystem for 3-D tooling | Rejected |
| Blazor WASM | Pure C# full-stack | Three.js integration requires JS interop shim; slower iteration | Rejected |
| Electron + plain JS | Desktop without browser dependency | No type safety; Three.js still needed; Electron overhead | Deferred (for packaging layer) |

### Database

| Option | Decision |
|---|---|
| **SQLite** (dev/desktop) | Chosen — zero config, file-based, portable |
| **PostgreSQL** (production) | Chosen — swap via connection string; same EF Core code |
| SQL Server | Rejected — licensing cost, Windows-only |
| MongoDB | Rejected — relational integrity required for profiles/jobs |

---

## Consequences

- Developers need .NET 8 SDK and Node 20+.
- All machine-specific logic is isolated behind interfaces (`IMachineDriver`, `ISlicingEngine`) so language/framework changes are confined to one adapter class.
- The frontend build outputs to `wwwroot/` and is served as static files by ASP.NET Core — no separate web server needed.
