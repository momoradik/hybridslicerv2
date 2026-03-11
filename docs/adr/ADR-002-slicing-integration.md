# ADR-002 — Slicing Engine Integration Strategy

**Date:** 2026-03-09
**Status:** Accepted

---

## Context

3-D printing slicing (STL → G-code) is a complex solved problem. Writing a production slicer from scratch would take months and still produce inferior results compared to mature open-source slicers.

Options for integrating slicing capability:

1. **Direct API** — call slicer code as a library
2. **Subprocess (CLI)** — invoke the slicer binary
3. **Reimplement** — write our own slicer

---

## Decision

**Use CuraEngine as a CLI subprocess via `CuraEngineAdapter`.**

CuraEngine is the open-source backend of Ultimaker Cura (MIT-licensed). It accepts:
- An STL file (`-l model.stl`)
- A JSON configuration file (`-j config.json`) with all print settings
- An output path (`-o print.gcode`)

Our `CuraEngineAdapter` maps `SlicingParameters` (derived from `PrintProfile`) to CuraEngine's `fdmprinter.def.json` setting keys.

---

## Alternatives Rejected

| Option | Reason rejected |
|---|---|
| PrusaSlicer CLI | Similar capability; CuraEngine has better JSON config API |
| libArachne / libcuraengine (direct library) | No stable C# binding; P/Invoke complexity outweighs subprocess simplicity |
| Custom slicer | 12+ months of work, quality gap vs. Cura |
| Python Slic3r wrapper | Adds Python runtime dependency; subprocess approach works equally well from C# |

---

## Interface Design

The integration is hidden behind `ISlicingEngine`:

```csharp
public interface ISlicingEngine {
    Task<SlicingResult> SliceAsync(
        string stlFilePath,
        SlicingParameters parameters,
        CancellationToken cancellationToken = default);
}
```

This means:
- The adapter can be swapped (PrusaSlicer, Bambu, custom) without touching any use case or domain code.
- The adapter is testable by substituting a mock `ISlicingEngine`.
- A future cloud slicing API can be dropped in as another adapter.

---

## Consequences

- CuraEngine must be installed on every host machine (or bundled in the installer).
- The adapter pins to CuraEngine's JSON config schema, which may change between major versions. Adapter unit tests validate the key mapping.
- Slicing is synchronous in Phase 1; Phase 4 TODO adds async progress streaming.
