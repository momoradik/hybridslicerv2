namespace HybridSlicer.Infrastructure.Slicing.MultiExtruder;

/// <summary>
/// Represents a single contiguous section of G-code belonging to one Cura feature type.
/// </summary>
public sealed class GCodeSection
{
    public required string Feature { get; init; }   // e.g. "WALL-OUTER", "FILL", "SUPPORT"
    public required int Layer { get; init; }         // -1 = header/pre-layer
    public required List<string> Lines { get; init; }
}

/// <summary>
/// Result of parsing a Cura G-code file into structured sections.
/// </summary>
public sealed class ParsedGCodeFile
{
    /// <summary>Lines before the first ;LAYER: marker (startup, homing, heating).</summary>
    public required List<string> Header { get; init; }

    /// <summary>Ordered list of feature sections (each annotated with feature type and layer).</summary>
    public required List<GCodeSection> Sections { get; init; }

    /// <summary>Lines after the last feature section (end G-code, M84, etc.).</summary>
    public required List<string> Footer { get; init; }
}

/// <summary>
/// Parses CuraEngine G-code into structured sections based on ;TYPE: and ;LAYER: comments.
///
/// Cura (with -p flag) reliably emits these markers:
///   ;LAYER:N          layer boundary
///   ;TYPE:WALL-OUTER  outer perimeter
///   ;TYPE:WALL-INNER  inner perimeters
///   ;TYPE:FILL        sparse infill
///   ;TYPE:SKIN        top/bottom solid fill
///   ;TYPE:SUPPORT     support material
///   ;TYPE:SUPPORT-INTERFACE  support-part interface
///   ;TYPE:SKIRT       skirt/brim
/// </summary>
public static class GCodeFeatureParser
{
    /// <summary>
    /// Parses raw G-code text into header, typed sections, and footer.
    /// Each section break occurs at a ;TYPE: comment.
    /// </summary>
    public static ParsedGCodeFile Parse(string gcode)
    {
        var header = new List<string>();
        var sections = new List<GCodeSection>();
        var footer = new List<string>();

        var lines = gcode.Split('\n');
        var inHeader = true;
        var currentLayer = -1;
        var currentFeature = "UNKNOWN";
        List<string>? currentLines = null;
        var reachedEnd = false;

        foreach (var rawLine in lines)
        {
            var line = rawLine.TrimEnd('\r');

            // Detect end G-code marker (Cura emits ";End of Gcode" or just M84/M104 S0 patterns)
            // We use ;END_CODE or the absence of further ;TYPE: markers after the last layer.
            // For robustness: if we see M84 after layers started, treat as footer.
            if (!inHeader && !reachedEnd && IsEndMarker(line))
            {
                // Flush current section
                if (currentLines != null && currentLines.Count > 0)
                    sections.Add(new GCodeSection { Feature = currentFeature, Layer = currentLayer, Lines = currentLines });
                currentLines = null;
                reachedEnd = true;
            }

            if (reachedEnd)
            {
                footer.Add(line);
                continue;
            }

            // Detect first layer start
            if (inHeader && line.StartsWith(";LAYER:", StringComparison.Ordinal))
            {
                inHeader = false;
                if (int.TryParse(line.AsSpan(7), out var ln))
                    currentLayer = ln;
                // Start the first section
                currentLines = [line];
                currentFeature = "UNKNOWN";
                continue;
            }

            if (inHeader)
            {
                header.Add(line);
                continue;
            }

            // Layer change
            if (line.StartsWith(";LAYER:", StringComparison.Ordinal))
            {
                if (int.TryParse(line.AsSpan(7), out var ln))
                    currentLayer = ln;
                // Layer changes don't create new sections — they update the layer counter.
                // The next ;TYPE: will create a new section.
                currentLines ??= [];
                currentLines.Add(line);
                continue;
            }

            // Feature type change → new section
            if (line.StartsWith(";TYPE:", StringComparison.Ordinal))
            {
                // Flush previous section
                if (currentLines != null && currentLines.Count > 0)
                    sections.Add(new GCodeSection { Feature = currentFeature, Layer = currentLayer, Lines = currentLines });

                currentFeature = line[6..].Trim().ToUpperInvariant();
                currentLines = [line];
                continue;
            }

            // Regular line — append to current section
            currentLines ??= [];
            currentLines.Add(line);
        }

        // Flush final section
        if (currentLines != null && currentLines.Count > 0 && !reachedEnd)
            sections.Add(new GCodeSection { Feature = currentFeature, Layer = currentLayer, Lines = currentLines });

        return new ParsedGCodeFile { Header = header, Sections = sections, Footer = footer };
    }

    private static bool IsEndMarker(string line)
    {
        // Common end patterns emitted by Cura
        var t = line.TrimStart();
        if (t.StartsWith(";End of Gcode", StringComparison.OrdinalIgnoreCase)) return true;
        if (t.StartsWith(";END_CODE", StringComparison.OrdinalIgnoreCase)) return true;
        // M84 (disable steppers) typically signals end-of-print
        if (t.StartsWith("M84", StringComparison.OrdinalIgnoreCase)) return true;
        return false;
    }
}
