using HybridSlicer.Domain.Entities;

namespace HybridSlicer.Application.Interfaces;

/// <summary>
/// Port for the hybrid process planning orchestrator.
/// Takes validated print and CNC G-codes plus custom blocks and produces
/// a single ordered HybridProcessPlan with an executable merged G-code file.
/// </summary>
public interface IHybridOrchestrator
{
    Task<HybridPlanResult> BuildPlanAsync(
        HybridPlanRequest request,
        CancellationToken cancellationToken = default);
}

public sealed record HybridPlanRequest(
    Guid JobId,
    string PrintGCodePath,
    /// <summary>CNC G-code keyed by layer index at which machining occurs (parsed from toolpath.gcode).</summary>
    IReadOnlyDictionary<int, string> CncGCodeByLayer,
    /// <summary>G-code emitted once before the first machining block (spindle positioning).</summary>
    string CncPreamble,
    /// <summary>G-code emitted once after the last machining block (spindle park + M5).</summary>
    string CncPostamble,
    int MachineEveryNLayers,
    int TotalPrintLayers,
    Guid CncToolId,
    IReadOnlyList<CustomGCodeBlock> EnabledCustomBlocks,
    string OutputGCodePath);

public sealed record HybridPlanResult(
    HybridProcessPlan Plan,
    string HybridGCodePath);
