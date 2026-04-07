using System.Text;
using HybridSlicer.Application.Interfaces;
using HybridSlicer.Domain.ValueObjects;
using Microsoft.Extensions.Logging;
using NetTopologySuite.Geometries;

namespace HybridSlicer.Infrastructure.Toolpath;

/// <summary>
/// Generates 2.5-D contour-milling CNC G-code from either:
///   (A) Pre-extracted Cura wall paths  [primary — PlanFromWallPathsAsync]
///   (B) Direct STL cross-section       [fallback — PlanContourAsync]
///
/// Tool-radius compensation (CRC) for outer wall paths:
///   CNC tool center = Cura nozzle path + (tool_radius + nozzle_radius)  [outward]
///   Rationale: Cura nozzle center is nozzle_radius INWARD of the part outer surface.
///              CNC tool center must be tool_radius OUTWARD of that same surface.
///              Net offset from Cura path = nozzle_radius + tool_radius.
///
/// For inner wall paths (holes/pockets):
///   CNC tool center = Cura nozzle path − (tool_radius + nozzle_radius) [inward]
/// </summary>
public sealed class ContourToolpathPlanner : IToolpathPlanner
{
    private static readonly GeometryFactory GF = new(new PrecisionModel(1000), 0);
    private readonly ILogger<ContourToolpathPlanner> _logger;

    public ContourToolpathPlanner(ILogger<ContourToolpathPlanner> logger) => _logger = logger;

    // ── Primary: plan from Cura wall paths ────────────────────────────────────

    public Task<ToolpathResult> PlanFromWallPathsAsync(
        WallPathsRequest request,
        CancellationToken cancellationToken = default)
    {
        return Task.FromResult(PlanFromWallPathsCore(request));
    }

    private ToolpathResult PlanFromWallPathsCore(WallPathsRequest request)
    {
        _logger.LogDebug(
            "PlanFromWallPaths Z={Z} mm  tool Ø{D} mm  nozzle Ø{N} mm  {Count} path segments",
            request.ZHeightMm, request.ToolDiameterMm, request.NozzleDiameterMm,
            request.WallPaths.Count);

        if (request.WallPaths.Count == 0)
            return new ToolpathResult(string.Empty, true, []);

        // CRC offset: tool_radius + nozzle_radius
        // Outward (+) for outer walls; inward (−) for inner walls (pockets/holes)
        var toolRadius   = request.ToolDiameterMm   / 2.0;
        var nozzleRadius = request.NozzleDiameterMm / 2.0;
        var crcOffset    = request.IsOuterWall
            ?  (toolRadius + nozzleRadius)   // expand outward
            : -(toolRadius + nozzleRadius);  // shrink inward

        var dx = request.MachineOffset.X;
        var dy = request.MachineOffset.Y;
        var dz = request.MachineOffset.Z;

        var zCut  = request.ZHeightMm + dz;
        var zSafe = request.SafeClearanceHeightMm + request.ZHeightMm + dz;

        var gcodeBuilder = new StringBuilder();
        var allBounds    = new List<BoundingBox2D>();

        // Process each path segment independently
        // Each segment is a connected sequence of G1 extrusion moves from Cura
        foreach (var seg in request.WallPaths)
        {
            if (seg.Count < 2) continue;

            // Build geometry: try closed polygon first, fall back to open linestring
            var geom = BuildGeometry(seg);
            if (geom is null || geom.IsEmpty) continue;

            // Apply cutter-radius compensation via NTS buffer
            Geometry compensated;
            try
            {
                compensated = geom.Buffer(crcOffset, 16);
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "Buffer failed for segment at Z={Z}, skipping", request.ZHeightMm);
                continue;
            }

            if (compensated is null || compensated.IsEmpty) continue;

            // Extract exterior ring(s) from the buffered geometry
            var rings = ExtractRings(compensated);
            foreach (var ring in rings)
            {
                if (ring.Count < 3) continue;
                var gcode = BuildGCode(
                    ring, zCut, zSafe,
                    request.FeedRateMmPerMin, request.SpindleRpm,
                    dx, dy, request.ClimbMilling);
                gcodeBuilder.AppendLine(gcode);

                var env = compensated.EnvelopeInternal;
                allBounds.Add(new BoundingBox2D(
                    env.MinX + dx, env.MinY + dy,
                    env.MaxX + dx, env.MaxY + dy));
            }
        }

        var totalGCode = gcodeBuilder.ToString().Trim();
        return totalGCode.Length == 0
            ? new ToolpathResult(string.Empty, true, [])
            : new ToolpathResult(totalGCode, false, allBounds);
    }

    // ── Fallback: plan from STL cross-section ─────────────────────────────────

    public async Task<ToolpathResult> PlanContourAsync(
        ToolpathRequest request,
        CancellationToken cancellationToken = default)
    {
        _logger.LogDebug("PlanContour (STL fallback) Z={Z} mm, tool Ø{D} mm",
            request.ZHeightMm, request.ToolDiameterMm);

        var polygon = await Task.Run(
            () => ExtractContourAtZ(request.StlFilePath, request.ZHeightMm),
            cancellationToken);

        if (polygon is null || polygon.IsEmpty)
        {
            _logger.LogDebug("No STL geometry at Z={Z}", request.ZHeightMm);
            return new ToolpathResult(string.Empty, true, []);
        }

        var offsetDist  = request.ToolDiameterMm / 2.0;
        var compensated = (Polygon)polygon.Buffer(offsetDist, 16);

        var dx = request.MachineOffset.X;
        var dy = request.MachineOffset.Y;
        var dz = request.MachineOffset.Z;

        var gcode = BuildGCode(
            compensated.ExteriorRing.Coordinates.Select(c => (c.X, c.Y)).ToList(),
            request.ZHeightMm + dz,
            request.SafeClearanceHeightMm + request.ZHeightMm + dz,
            request.FeedRateMmPerMin, request.SpindleRpm,
            dx, dy, request.ClimbMilling);

        var env    = compensated.EnvelopeInternal;
        var bounds = new BoundingBox2D(env.MinX + dx, env.MinY + dy, env.MaxX + dx, env.MaxY + dy);

        return new ToolpathResult(gcode, false, [bounds]);
    }

    // ── Geometry helpers ──────────────────────────────────────────────────────

    /// <summary>
    /// Builds a NTS Geometry from a list of XY points.
    /// If the path is (approximately) closed it becomes a Polygon,
    /// otherwise a LineString.
    /// </summary>
    private static Geometry? BuildGeometry(IReadOnlyList<(double X, double Y)> points)
    {
        const double closeTolerance = 0.5; // mm

        var coords = points.Select(p => new Coordinate(p.X, p.Y)).ToList();

        // Check if the path closes on itself
        var first = coords[0];
        var last  = coords[^1];
        var dist  = Math.Sqrt(Math.Pow(last.X - first.X, 2) + Math.Pow(last.Y - first.Y, 2));
        var isClosed = dist <= closeTolerance;

        if (isClosed)
        {
            // Ensure the ring is explicitly closed
            if (dist > 1e-9) coords.Add(new Coordinate(first.X, first.Y));
            if (coords.Count < 4) return null;  // Need ≥4 for a valid ring (3 unique + close)

            try
            {
                var ring = GF.CreateLinearRing(coords.ToArray());
                return GF.CreatePolygon(ring);
            }
            catch
            {
                // Fall back to convex hull if ring is self-intersecting
                var mp = GF.CreateMultiPointFromCoords(coords.ToArray());
                return mp.ConvexHull();
            }
        }
        else
        {
            // Open path — buffer the LineString to get a ribbon
            if (coords.Count < 2) return null;
            return GF.CreateLineString(coords.ToArray());
        }
    }

    /// <summary>Extracts all exterior rings from a buffered geometry.</summary>
    private static List<List<(double X, double Y)>> ExtractRings(Geometry geom)
    {
        var result = new List<List<(double X, double Y)>>();

        void AddRing(Polygon poly)
        {
            var ring = poly.ExteriorRing.Coordinates
                .Select(c => (c.X, c.Y))
                .ToList();
            if (ring.Count >= 3) result.Add(ring);
        }

        if (geom is Polygon p)       { AddRing(p); }
        else if (geom is MultiPolygon mp) { foreach (var g in mp.Geometries.OfType<Polygon>()) AddRing(g); }
        else if (geom is GeometryCollection gc) { foreach (var g in gc.Geometries.OfType<Polygon>()) AddRing(g); }

        return result;
    }

    /// <summary>
    /// Correct plane–triangle intersection:
    /// Finds the two edges of a triangle that straddle Z=zHeight and
    /// returns the interpolated XY intersection point on each edge as a segment.
    /// </summary>
    private static Polygon? ExtractContourAtZ(string stlPath, double zHeight)
    {
        var segments = new List<(double x1, double y1, double x2, double y2)>();

        using var fs     = new FileStream(stlPath, FileMode.Open, FileAccess.Read, FileShare.Read);
        using var reader = new BinaryReader(fs);

        var header        = reader.ReadBytes(80);
        var triangleCount = reader.ReadUInt32();

        var expectedSize = 80L + 4L + triangleCount * 50L;
        if (fs.Length != expectedSize || triangleCount == 0) return null;

        for (var i = 0; i < triangleCount; i++)
        {
            // Skip normal
            reader.ReadSingle(); reader.ReadSingle(); reader.ReadSingle();

            double[] vx = new double[3], vy = new double[3], vz = new double[3];
            for (var v = 0; v < 3; v++)
            {
                vx[v] = reader.ReadSingle();
                vy[v] = reader.ReadSingle();
                vz[v] = reader.ReadSingle();
            }
            reader.ReadUInt16(); // attribute byte count

            // Find the two edges that straddle Z=zHeight (independently, not from a shared vertex)
            var crossings = new List<(double x, double y)>();
            for (var a = 0; a < 3; a++)
            {
                var b  = (a + 1) % 3;
                var za = vz[a]; var zb = vz[b];

                // Edge straddles the plane if one vertex is at or below and the other above
                var aboveA = za > zHeight;
                var aboveB = zb > zHeight;
                if (aboveA == aboveB) continue;   // same side — no crossing

                if (Math.Abs(za - zb) < 1e-12) continue;
                var t  = (zHeight - za) / (zb - za);
                var xi = vx[a] + t * (vx[b] - vx[a]);
                var yi = vy[a] + t * (vy[b] - vy[a]);
                crossings.Add((xi, yi));
            }

            // A plane through a triangle gives exactly 0 or 2 crossings
            if (crossings.Count == 2)
                segments.Add((crossings[0].x, crossings[0].y,
                              crossings[1].x, crossings[1].y));
        }

        if (segments.Count == 0) return null;

        var coords = segments
            .SelectMany(s => new[] { new Coordinate(s.x1, s.y1), new Coordinate(s.x2, s.y2) })
            .Distinct()
            .ToArray();

        if (coords.Length < 3) return null;

        var hull = (Polygon)GF.CreateMultiPointFromCoords(coords).ConvexHull();
        return hull.IsValid ? hull : null;
    }

    // ── G-code builder ────────────────────────────────────────────────────────

    private static string BuildGCode(
        IList<(double X, double Y)> coords,
        double zCut, double zSafe,
        double feed, int rpm,
        double dx, double dy,
        bool climb)
    {
        if (coords.Count == 0) return string.Empty;

        var pts = climb ? coords : coords.Reverse().ToList();

        var sb = new StringBuilder();
        sb.AppendLine($"; === Contour Milling Z={zCut:F3} ===");
        sb.AppendLine($"M3 S{rpm}");
        sb.AppendLine($"G0 Z{zSafe:F3}");
        sb.AppendLine($"G0 X{pts[0].X + dx:F3} Y{pts[0].Y + dy:F3}");
        sb.AppendLine($"G1 Z{zCut:F3} F{feed * 0.3:F0}");
        sb.AppendLine($"G1 F{feed:F0}");
        foreach (var pt in pts.Skip(1))
            sb.AppendLine($"G1 X{pt.X + dx:F3} Y{pt.Y + dy:F3}");
        sb.AppendLine($"G0 Z{zSafe:F3}");
        sb.AppendLine("M5");
        sb.AppendLine($"; === End Contour Z={zCut:F3} ===");
        return sb.ToString();
    }
}
