namespace HybridSlicer.Application.Interfaces;

/// <summary>
/// Parses CuraEngine G-code output and extracts per-layer, per-section XY paths.
/// </summary>
public interface ICuraGCodeParser
{
    ParsedCuraGCode Parse(string gcodeText);
}

public sealed record ParsedCuraGCode(
    IReadOnlyDictionary<int, ParsedCuraLayer> Layers);

public sealed record ParsedCuraLayer(
    int LayerIndex,
    double ZHeightMm,
    IReadOnlyList<IReadOnlyList<(double X, double Y)>> OuterWallPaths,
    IReadOnlyList<IReadOnlyList<(double X, double Y)>> InnerWallPaths,
    IReadOnlyList<IReadOnlyList<(double X, double Y)>> SupportPaths);
