namespace HybridSlicer.Domain.Entities;

/// <summary>
/// Length and radius compensation offset for a specific tool index.
/// </summary>
public sealed record ToolOffset(
    int ToolIndex,
    double LengthOffsetMm,
    double RadiusOffsetMm,
    double OffsetX = 0,
    double OffsetY = 0,
    double OffsetZ = 0,
    string? Description = null);
