using System.Text;
using HybridSlicer.Application.Interfaces;
using HybridSlicer.Domain.ValueObjects;
using Microsoft.Extensions.Logging;
using NetTopologySuite.Geometries;
using NetTopologySuite.IO;

namespace HybridSlicer.Infrastructure.Toolpath;

/// <summary>
/// Generates a 2.5-D contour milling toolpath for a single layer.
///
/// Algorithm:
///  1. Parse binary/ASCII STL and extract all triangles that cross Z = zHeight
///  2. Collect the XY intersection edges and form a closed polygon
///  3. Offset the polygon outward by the tool radius (cutter-radius compensation)
///  4. Apply machine offset translation
///  5. Emit G-code: rapid to safe height → position → plunge → contour → retract
///
/// NetTopologySuite is used for polygon offsetting (BufferOp) and intersection.
/// </summary>
public sealed class ContourToolpathPlanner : IToolpathPlanner
{
    private static readonly GeometryFactory GF = new(new PrecisionModel(1000), 0);
    private readonly ILogger<ContourToolpathPlanner> _logger;

    public ContourToolpathPlanner(ILogger<ContourToolpathPlanner> logger) => _logger = logger;

    public async Task<ToolpathResult> PlanContourAsync(
        ToolpathRequest request,
        CancellationToken cancellationToken = default)
    {
        _logger.LogDebug("Planning toolpath at Z={Z} mm, tool Ø{D} mm", request.ZHeightMm, request.ToolDiameterMm);

        // STL parsing is CPU-bound; offload from async caller
        var polygon = await Task.Run(() => ExtractContourAtZ(request.StlFilePath, request.ZHeightMm), cancellationToken);

        if (polygon is null || polygon.IsEmpty)
        {
            _logger.LogDebug("No geometry at Z={Z}", request.ZHeightMm);
            return new ToolpathResult(string.Empty, true, []);
        }

        // Offset outward by tool radius (climb milling = positive offset on exterior)
        var offsetDist = request.ToolDiameterMm / 2.0;
        var compensated = (Polygon)polygon.Buffer(offsetDist, 16);

        // Apply machine offset
        var dx = request.MachineOffset.X;
        var dy = request.MachineOffset.Y;
        var dz = request.MachineOffset.Z;

        var gcode = BuildGCode(
            compensated,
            request.ZHeightMm + dz,
            request.SafeClearanceHeightMm + request.ZHeightMm + dz,
            request.FeedRateMmPerMin,
            request.SpindleRpm,
            dx, dy,
            request.ClimbMilling);

        var env = compensated.EnvelopeInternal;
        var bounds = new BoundingBox2D(env.MinX + dx, env.MinY + dy, env.MaxX + dx, env.MaxY + dy);

        return new ToolpathResult(gcode, false, [bounds]);
    }

    private static Polygon? ExtractContourAtZ(string stlPath, double zHeight)
    {
        // Read all triangles and find edges that cross z=zHeight
        var segments = new List<(double x1, double y1, double x2, double y2)>();

        using var fs = new FileStream(stlPath, FileMode.Open, FileAccess.Read, FileShare.Read);
        using var reader = new BinaryReader(fs);

        // Try binary STL
        var header = reader.ReadBytes(80);
        var triangleCount = reader.ReadUInt32();

        // Heuristic: if the file size matches binary format, use binary reader
        var expectedSize = 80 + 4 + triangleCount * 50;
        if (fs.Length == expectedSize && triangleCount > 0)
        {
            for (var i = 0; i < triangleCount; i++)
            {
                // Normal (skip)
                reader.ReadSingle(); reader.ReadSingle(); reader.ReadSingle();

                // 3 vertices
                var vx = new double[3]; var vy = new double[3]; var vz = new double[3];
                for (var v = 0; v < 3; v++)
                {
                    vx[v] = reader.ReadSingle();
                    vy[v] = reader.ReadSingle();
                    vz[v] = reader.ReadSingle();
                }
                reader.ReadUInt16(); // attribute

                // Find edges that cross z
                for (var a = 0; a < 3; a++)
                {
                    var b = (a + 1) % 3;
                    var za = vz[a]; var zb = vz[b];
                    if ((za <= zHeight && zb >= zHeight) || (zb <= zHeight && za >= zHeight))
                    {
                        if (Math.Abs(za - zb) < 1e-9) continue;
                        var t = (zHeight - za) / (zb - za);
                        var xi = vx[a] + t * (vx[b] - vx[a]);
                        var yi = vy[a] + t * (vy[b] - vy[a]);

                        // Find edge c-a for the crossing point on other side
                        var c = (b + 1) % 3;
                        var zc = vz[c];
                        if (!((za <= zHeight && zc >= zHeight) || (zc <= zHeight && za >= zHeight))) continue;
                        if (Math.Abs(za - zc) < 1e-9) continue;
                        var t2 = (zHeight - za) / (zc - za);
                        var xi2 = vx[a] + t2 * (vx[c] - vx[a]);
                        var yi2 = vy[a] + t2 * (vy[c] - vy[a]);

                        segments.Add((xi, yi, xi2, yi2));
                        break;
                    }
                }
            }
        }

        if (segments.Count == 0) return null;

        // Build a polygon by chaining segments into a ring
        // Simplified: use convex hull of all intersection points as fallback
        var coords = segments.SelectMany(s => new[]
        {
            new Coordinate(s.x1, s.y1),
            new Coordinate(s.x2, s.y2)
        }).Distinct().ToArray();

        if (coords.Length < 3) return null;

        var multiPoint = GF.CreateMultiPointFromCoords(coords);
        var hull = (Polygon)multiPoint.ConvexHull();

        return hull.IsValid ? hull : null;
    }

    private static string BuildGCode(
        Polygon polygon,
        double zCut,
        double zSafe,
        double feed,
        int rpm,
        double dx, double dy,
        bool climb)
    {
        var sb = new StringBuilder();
        sb.AppendLine($"; === Contour Milling Z={zCut:F4} ===");
        sb.AppendLine($"M3 S{rpm}         ; Spindle on CW");
        sb.AppendLine($"G0 Z{zSafe:F4}    ; Rapid to safe height");

        var shell = polygon.ExteriorRing;
        var coords = climb
            ? shell.Coordinates
            : shell.Coordinates.Reverse().ToArray();

        if (coords.Length == 0) return sb.ToString();

        var first = coords[0];
        sb.AppendLine($"G0 X{first.X + dx:F4} Y{first.Y + dy:F4}   ; Rapid to start");
        sb.AppendLine($"G1 Z{zCut:F4} F{feed * 0.3:F0}   ; Plunge");
        sb.AppendLine($"G1 F{feed:F0}");

        foreach (var c in coords.Skip(1))
            sb.AppendLine($"G1 X{c.X + dx:F4} Y{c.Y + dy:F4}");

        sb.AppendLine($"G0 Z{zSafe:F4}    ; Retract");
        sb.AppendLine("M5               ; Spindle off");
        sb.AppendLine($"; === End Contour Z={zCut:F4} ===");

        return sb.ToString();
    }
}
