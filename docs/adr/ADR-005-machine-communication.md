# ADR-005 — Machine Communication Strategy

**Date:** 2026-03-09
**Status:** Accepted

---

## Context

The system must send G-code to a physical machine (printer + CNC) and receive status updates (temperatures, position, acknowledgements). Several transport options exist:

- USB serial (most common for desktop 3-D printers)
- TCP/IP over local network (Octoprint, Duet, Klipper)
- Vendor APIs (Bambu, Formlabs — proprietary, out of scope)

---

## Decision

**Primary: TCP/IP via `TcpMachineDriver` implementing `IMachineDriver`.**
**Secondary: Serial port adapter to be added in Phase 9.**

### Why TCP first?

- Hybrid manufacturing machines (especially CNC-capable ones) are more likely to have network connectivity (Duet3, LinuxCNC with network plugin, Octoprint).
- TCP avoids the OS-level complexity of serial port enumeration, baud-rate negotiation, and driver installation.
- Both transports can run the same G-code protocol (Marlin-compatible `ok` acknowledgement).

---

## Protocol Design

```
Client sends: "G1 X50 Y50 Z10 F300\n"
Machine replies: "ok\n"  (or "ok T:210 B:60\n" with temperature report)
```

Flow control: the driver waits for `ok` before sending the next line (`TcpMachineDriver.WaitForOkAsync()`). This matches Marlin's standard line-by-line protocol and prevents buffer overflow on the machine controller.

---

## Real-time Status

Machine status events (temperature, position) are broadcast to all connected SignalR clients via `MachineHub`. The UI receives events and updates the header bar and job progress without polling.

```
TcpMachineDriver.StatusChanged event
    → MachineHub raises Clients.All.SendAsync("MachineStatusChanged", evt)
    → React useMachineConnection hook receives evt
    → Zustand store updates extruderTemp, bedTemp, jobProgress
```

---

## Interface Design

```csharp
public interface IMachineDriver : IAsyncDisposable {
    bool IsConnected { get; }
    Task ConnectAsync(string host, int port, CancellationToken ct);
    Task DisconnectAsync();
    Task SendCommandAsync(string gcode, CancellationToken ct);
    IAsyncEnumerable<MachineProgress> StreamFileAsync(string gcodePath, CancellationToken ct);
    event EventHandler<MachineStatusEvent>? StatusChanged;
}
```

A `SerialMachineDriver` or `GrblMachineDriver` can be swapped in via DI configuration without touching any other code.

---

## Consequences

- The TCP driver assumes a Marlin-compatible `ok` protocol. Grbl and RepRap variants need a separate driver.
- `IMachineDriver` is `IAsyncDisposable`. The DI lifetime is `Scoped` for request-bound use; the SignalR hub manages its own long-lived instance explicitly.
- Concurrent sends are serialised by a `SemaphoreSlim(1,1)` lock in `TcpMachineDriver`. This matches the machine's expectation of single-threaded command streams.
