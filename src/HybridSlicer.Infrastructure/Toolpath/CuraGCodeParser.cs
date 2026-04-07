using System.Globalization;
using HybridSlicer.Application.Interfaces;

namespace HybridSlicer.Infrastructure.Toolpath;

/// <summary>
/// Parses CuraEngine G-code output and extracts per-layer, per-section XY paths.
///
/// Cura G-code section markers (emitted when slicing with the -p flag):
///   ;LAYER:N        — start of layer N (0-based)
///   ;TYPE:WALL-OUTER — outer perimeter extrusion moves follow
///   ;TYPE:WALL-INNER — inner perimeter extrusion moves follow
///   ;TYPE:SUPPORT   — support structure extrusion moves follow
///   ;TYPE:FILL      — infill extrusion moves follow
///   ;TYPE:SKIN      — top/bottom skin extrusion moves follow
///
/// Path-break logic:
///   G0 (rapid travel)  → ends the current segment; next G1 starts a new one.
///   G1 with no X/Y     → retraction/prime; ends the current segment.
///   G1 with X/Y + E    → appended to the current segment (actual extrusion).
/// </summary>
public sealed class CuraGCodeParser : ICuraGCodeParser
{
    public ParsedCuraGCode Parse(string gcodeText)
    {
        var layers = new Dictionary<int, ParsedCuraLayer>();

        var currentLayer = -1;
        var currentZ     = 0.0;
        var currentType  = string.Empty;
        var curX         = 0.0;
        var curY         = 0.0;

        Dictionary<string, List<List<(double X, double Y)>>> currentPaths = new();
        List<(double X, double Y)>?                          currentSeg   = null;

        foreach (var rawLine in gcodeText.Split('\n'))
        {
            var line = rawLine.Trim();
            if (line.Length == 0) continue;

            // ── Cura section markers ──────────────────────────────────────────
            if (line.StartsWith(";LAYER:", StringComparison.Ordinal))
            {
                if (currentLayer >= 0)
                    layers[currentLayer] = BuildLayer(currentLayer, currentZ, currentPaths);

                if (int.TryParse(line[7..].Trim(), out var ln))
                {
                    currentLayer = ln;
                    currentType  = string.Empty;
                    currentPaths = new();
                    currentSeg   = null;
                }
                continue;
            }

            if (line.StartsWith(";TYPE:", StringComparison.Ordinal))
            {
                currentType = line[6..].Trim().ToUpperInvariant();
                currentSeg  = null;   // new section = new path segment
                continue;
            }

            // ── Skip comment-only lines ───────────────────────────────────────
            if (line.StartsWith(';')) continue;

            // Strip inline comment
            var ci = line.IndexOf(';');
            var cmd = ci >= 0 ? line[..ci].Trim() : line;
            if (string.IsNullOrWhiteSpace(cmd)) continue;

            var tokens = cmd.Split(' ', StringSplitOptions.RemoveEmptyEntries);
            if (tokens.Length == 0) continue;

            var gcmd = tokens[0].ToUpperInvariant();
            if (gcmd != "G0" && gcmd != "G1") continue;

            // ── Parse coordinates ─────────────────────────────────────────────
            double? x = null, y = null, z = null;
            var hasExtrusion = false;

            for (var i = 1; i < tokens.Length; i++)
            {
                var t = tokens[i];
                if (t.Length < 2) continue;
                var axis = char.ToUpperInvariant(t[0]);
                if (!double.TryParse(t[1..], NumberStyles.Float,
                        CultureInfo.InvariantCulture, out var val)) continue;
                switch (axis)
                {
                    case 'X': x = val; break;
                    case 'Y': y = val; break;
                    case 'Z': z = val; break;
                    case 'E': hasExtrusion = true; break;
                }
            }

            if (z.HasValue) currentZ = z.Value;

            if (gcmd == "G0")
            {
                // Rapid travel — update position and break current segment
                if (x.HasValue) curX = x.Value;
                if (y.HasValue) curY = y.Value;
                currentSeg = null;
            }
            else // G1
            {
                if (x.HasValue) curX = x.Value;
                if (y.HasValue) curY = y.Value;

                // Record only extrusion moves that actually move in XY within a typed section
                if ((x.HasValue || y.HasValue) && hasExtrusion
                    && currentLayer >= 0 && currentType.Length > 0)
                {
                    if (!currentPaths.TryGetValue(currentType, out var typeSegs))
                    {
                        typeSegs = new();
                        currentPaths[currentType] = typeSegs;
                    }

                    if (currentSeg == null)
                    {
                        currentSeg = new();
                        typeSegs.Add(currentSeg);
                    }

                    currentSeg.Add((curX, curY));
                }
                else if (!x.HasValue && !y.HasValue)
                {
                    // Retraction / prime (only E or F) — break segment
                    currentSeg = null;
                }
            }
        }

        // Flush final layer
        if (currentLayer >= 0)
            layers[currentLayer] = BuildLayer(currentLayer, currentZ, currentPaths);

        return new ParsedCuraGCode(layers);
    }

    // ── Private helpers ───────────────────────────────────────────────────────

    private static ParsedCuraLayer BuildLayer(
        int idx, double z,
        Dictionary<string, List<List<(double X, double Y)>>> paths)
    {
        static IReadOnlyList<IReadOnlyList<(double X, double Y)>> Get(
            Dictionary<string, List<List<(double X, double Y)>>> d, string key)
            => d.TryGetValue(key, out var v)
                ? v.Where(p => p.Count >= 2)
                   .Select(p => (IReadOnlyList<(double X, double Y)>)p.AsReadOnly())
                   .ToList()
                : [];

        return new ParsedCuraLayer(idx, z,
            OuterWallPaths: Get(paths, "WALL-OUTER"),
            InnerWallPaths: Get(paths, "WALL-INNER"),
            SupportPaths:   Get(paths, "SUPPORT"));
    }
}

