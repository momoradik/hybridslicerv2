using HybridSlicer.Domain.Enums;
using HybridSlicer.Domain.ValueObjects;

namespace HybridSlicer.Application.Interfaces;

/// <summary>
/// Port for the safety and collision-avoidance subsystem.
/// All toolpath candidates must pass through this validator before they can
/// be promoted to SafetyStatus.Clear.  Any result other than Clear blocks execution.
/// </summary>
public interface ISafetyValidator
{
    Task<SafetyValidationResult> ValidateToolpathAsync(
        SafetyValidationRequest request,
        CancellationToken cancellationToken = default);
}

public sealed record SafetyValidationRequest(
    /// <summary>G-code string of the CNC toolpath to validate.</summary>
    string CncGCode,

    /// <summary>Bounding boxes of all already-printed geometry up to this layer.</summary>
    IReadOnlyList<BoundingBox3D> PrintedGeometryBounds,

    /// <summary>Machine envelope limits.</summary>
    double MachineMaxX,
    double MachineMaxY,
    double MachineMaxZ,

    /// <summary>Minimum safe rapid height above the part.</summary>
    double SafeClearanceHeightMm,

    /// <summary>Tool radius for engagement checks.</summary>
    double ToolRadiusMm);

public sealed record SafetyValidationResult(
    SafetyStatus Status,
    IReadOnlyList<string> Issues);

public sealed record BoundingBox3D(
    double MinX, double MinY, double MinZ,
    double MaxX, double MaxY, double MaxZ)
{
    public bool ContainsPoint(double x, double y, double z)
        => x >= MinX && x <= MaxX
        && y >= MinY && y <= MaxY
        && z >= MinZ && z <= MaxZ;
}
