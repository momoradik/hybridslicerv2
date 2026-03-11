using HybridSlicer.Domain.ValueObjects;

namespace HybridSlicer.Application.Interfaces;

/// <summary>
/// Port for CNC toolpath generation. Takes part geometry and tool specs,
/// produces G-code for a single machining operation at one layer height.
/// </summary>
public interface IToolpathPlanner
{
    /// <summary>
    /// Generates a contour-milling toolpath for the given STL cross-section
    /// at the specified Z height, applying cutter-radius compensation and
    /// machine offsets.
    /// </summary>
    Task<ToolpathResult> PlanContourAsync(
        ToolpathRequest request,
        CancellationToken cancellationToken = default);
}

public sealed record ToolpathRequest(
    string StlFilePath,
    double ZHeightMm,
    double ToolDiameterMm,
    double MaxDepthOfCutMm,
    double FeedRateMmPerMin,
    int SpindleRpm,
    MachineOffset MachineOffset,
    double SafeClearanceHeightMm,
    bool ClimbMilling = true);

public sealed record ToolpathResult(
    string GCode,
    bool IsEmpty,
    IReadOnlyList<BoundingBox2D> ToolpathBounds);

public sealed record BoundingBox2D(
    double MinX, double MinY,
    double MaxX, double MaxY)
{
    public bool Intersects(BoundingBox2D other)
        => MinX <= other.MaxX && MaxX >= other.MinX
        && MinY <= other.MaxY && MaxY >= other.MinY;
}
