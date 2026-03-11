# ADR-004 — Database Selection and Access Strategy

**Date:** 2026-03-09
**Status:** Accepted

---

## Context

The system needs to persist:
- Machine profiles (offsets, calibration, connectivity)
- Print profiles (Cura-equivalent settings)
- Materials, CNC tools
- Job state machine (status, file paths, error info)
- Process plans and steps (ordered, safety-validated)
- Custom G-code blocks
- Branding settings

---

## Decision

**Entity Framework Core 8 with SQLite (default) / PostgreSQL (production).**

The connection string in `appsettings.json` determines which provider is used. The application code does not change.

```
# Desktop / local (default)
"Default": "Data Source=/path/to/hybridslicer.db"

# Enterprise PostgreSQL
"Default": "Host=dbhost;Database=hybridslicer;Username=app;Password=..."
```

---

## Access Patterns

All database access goes through **repository interfaces** defined in `HybridSlicer.Application`:

```csharp
IMachineProfileRepository
IPrintProfileRepository
IPrintJobRepository
ICncToolRepository
ICustomGCodeBlockRepository
IMaterialRepository
```

Concrete implementations live in `HybridSlicer.Infrastructure.Persistence.Repositories`.

This ensures:
- Use cases depend on abstractions, not EF Core
- Repository implementations are independently testable with an in-memory provider
- A future NoSQL migration would only affect the infrastructure layer

---

## EF Core Design Choices

| Choice | Reason |
|---|---|
| Private setters on all entity properties | Enforce domain invariants; prevent accidental direct mutation |
| `OwnsOne` for `MachineOffset` (value object) | Stored as flat columns, no separate table needed |
| `OwnsMany` with `ToJson()` for `ToolOffsets` | JSON column avoids a join table for a small, rarely-queried collection |
| `HasQueryFilter(x => !x.IsDeleted)` | Global soft-delete filter; hard delete never used in domain |
| `HasConversion<string>` on all enums | Human-readable values in DB; survives enum reordering |
| `int.MaxValue` max-length on G-code columns | G-code files can be megabytes; no artificial truncation |

---

## Migrations

Migrations are generated in `HybridSlicer.Infrastructure` and run automatically on startup via `db.Database.MigrateAsync()`.

```bash
dotnet ef migrations add <Name> \
  --project src/HybridSlicer.Infrastructure \
  --startup-project src/HybridSlicer.Api
```

---

## Consequences

- EF Core adds ~200 KB to the binary and a small startup cost.
- SQLite's write-lock serialises concurrent write requests. For desktop single-user use this is fine. Enterprise use should switch to PostgreSQL.
- G-code text is stored on disk (not in DB) because blobs of hundreds of MB would make backup/restore impractical. DB stores only the file path.
