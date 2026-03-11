# ADR-003 — Safety as a First-Class Domain Concern

**Date:** 2026-03-09
**Status:** Accepted

---

## Context

In hybrid additive/subtractive manufacturing, a toolpath error can:
- Break a cutting tool
- Damage the workpiece
- Damage the machine
- In extreme cases, cause injury

Safety checking must be **mandatory and non-bypassable**, not an optional validation layer.

---

## Decision

**Safety validation is a hard gate controlled by `SafetyStatus` in the domain layer.**

Rules:
1. Every `ProcessStep` of type `Machining` starts with `SafetyStatus.Unvalidated` — the step **cannot execute** in this state.
2. Only `ISafetyValidator.ValidateToolpathAsync()` can promote a step to `Clear` or `Warning`.
3. `SafetyStatus.Blocked` means the toolpath **must not execute**. The `SafetyException` domain exception is thrown, which surfaces as HTTP 422. There is no API endpoint to override a `Blocked` step.
4. `SafetyStatus.Warning` requires explicit operator confirmation in the UI (a separate acknowledge endpoint, Phase 6).
5. `HybridProcessPlan.IsExecutionAllowed()` returns `false` if `OverallSafetyStatus` is `Unvalidated` or `Blocked`.

This is enforced at **three layers**:
- Domain: `SafetyException` thrown at rule violation
- Application: `GenerateToolpathsHandler` checks status before accepting a step
- API: `GlobalExceptionMiddleware` maps `SafetyException` to 422

---

## Validation Checks (Phase 1 — AABB)

| Check | Failure mode |
|---|---|
| Axis envelope | Blocked — motion outside machine limits |
| Rapid height clearance | Warning — G0 below safe Z height |
| Printed geometry intersection | Blocked — feed move inside printed AABB |
| Feed rate | Warning (Phase 6) — exceeds tool recommendation |

**Phase 2** replaces AABB with a Bounding Volume Hierarchy (BVH) mesh intersection for production-grade accuracy.

---

## Consequences

- The safety subsystem is fully isolated behind `ISafetyValidator`. The algorithm (AABB → BVH → NURBS) can be upgraded without touching any other code.
- Safety checks add latency to the toolpath generation step. For large models with many machining layers, this may be noticeable. Async parallel validation per layer is a planned optimisation.
- False positives (Warning when Clear would be correct) are acceptable. False negatives (Clear when Blocked should be the result) are unacceptable and are treated as bugs.
