# HybridSlicer

Production-grade hybrid additive/subtractive manufacturing platform.
Combines 3D printing slicing with CNC toolpath generation and hybrid execution sequencing — all in one unified application.

---

## Quick Start

### Prerequisites
| Tool | Version | Notes |
|---|---|---|
| .NET SDK | 8.0+ | `dotnet --version` |
| Node.js | 20+ | `node --version` |
| npm | 10+ | bundled with Node |
| CuraEngine | 5.x | add to PATH or set `CuraEngine:ExecutablePath` |

### 1 — Backend

```bash
cd src/HybridSlicer.Api

# Install EF Core tools (once)
dotnet tool install --global dotnet-ef

# Create the initial migration and database
dotnet ef migrations add InitialCreate \
  --project ../HybridSlicer.Infrastructure \
  --startup-project .

# Run the API (auto-seeds on first launch)
dotnet run
# → http://localhost:5000
# → Swagger UI: http://localhost:5000/swagger
```

### 2 — Frontend (development)

```bash
cd web
npm install
npm run dev
# → http://localhost:5173  (proxied to API on :5000)
```

### 3 — Production build (React → wwwroot)

```bash
cd web
npm run build
# Output goes to src/HybridSlicer.Api/wwwroot/
# Then run the API — it serves the SPA statically.
```

---

## Project Structure

```
Hybridslicer/
├── src/
│   ├── HybridSlicer.Domain/          Zero-dependency domain model
│   ├── HybridSlicer.Application/     Use cases, ports, DTOs (MediatR/CQRS)
│   ├── HybridSlicer.Infrastructure/  Adapters: DB, CuraEngine, TCP, safety
│   └── HybridSlicer.Api/             ASP.NET Core host, controllers, SignalR
├── web/                              React 18 + TypeScript + Three.js SPA
├── tests/
│   ├── HybridSlicer.Domain.Tests/
│   └── HybridSlicer.Application.Tests/
└── docs/
    ├── ASSUMPTIONS.md
    ├── TODO.md
    └── adr/                          Architecture Decision Records
```

---

## Configuration

All configuration lives in `src/HybridSlicer.Api/appsettings.json`.

| Key | Default | Description |
|---|---|---|
| `ConnectionStrings:Default` | `(auto SQLite)` | Override with PostgreSQL connection string |
| `Storage:Root` | `%LOCALAPPDATA%\HybridSlicer` | Job files, G-code, logs |
| `CuraEngine:ExecutablePath` | `CuraEngine` | Full path or name on PATH |
| `CuraEngine:TimeoutSeconds` | `600` | Max slice duration |

---

## Architecture Overview

```
React SPA (Three.js STL viewer)
    │  HTTPS + SignalR WS
ASP.NET Core 8 API
    │  MediatR commands/queries
Application layer (use cases)
    │  Interface injection
Infrastructure (EF Core | CuraEngine | Toolpath | Safety | TCP)
    │
Domain (entities, value objects — zero dependencies)
```

See `docs/adr/` for the reasoning behind every major technical decision.

---

## Running Tests

```bash
cd tests/HybridSlicer.Domain.Tests
dotnet test

cd tests/HybridSlicer.Application.Tests
dotnet test
```

---

## White-label / Branding

Change company name, colors, and logo via `PUT /api/branding` or the **Branding** page in the UI.
CSS custom properties (`--color-primary`, `--color-accent`) are applied at runtime with no rebuild needed.

---

## CuraEngine Integration

HybridSlicer delegates all 3D printing slicing to **CuraEngine** (the same engine powering Ultimaker Cura).

1. Download CuraEngine from the [Ultimaker/CuraEngine GitHub](https://github.com/Ultimaker/CuraEngine/releases)
2. Place it on your PATH or set the full path in `appsettings.json`
3. HybridSlicer generates the JSON config from your Print Profile and calls CuraEngine as a subprocess
4. The output G-code is then used by the Hybrid Orchestrator

---

## License

Proprietary — all rights reserved.
