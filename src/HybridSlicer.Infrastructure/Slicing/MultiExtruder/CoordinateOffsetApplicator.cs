using System.Globalization;
using System.Text;

namespace HybridSlicer.Infrastructure.Slicing.MultiExtruder;

/// <summary>
/// Applies X/Y coordinate offsets to G0/G1 move commands in G-code lines.
/// Used to shift all movements when a non-E0 extruder is active, compensating
/// for the physical distance between nozzles.
/// </summary>
public static class CoordinateOffsetApplicator
{
    private static readonly CultureInfo IC = CultureInfo.InvariantCulture;

    /// <summary>
    /// Processes a list of G-code lines, applying the given X/Y delta to every G0/G1 command.
    /// Lines that are not G0/G1 are returned unchanged.
    /// </summary>
    public static List<string> ApplyOffset(IReadOnlyList<string> lines, double dx, double dy)
    {
        if (dx == 0 && dy == 0)
            return new List<string>(lines);

        var result = new List<string>(lines.Count);
        foreach (var line in lines)
            result.Add(OffsetLine(line, dx, dy));
        return result;
    }

    /// <summary>
    /// Offsets X and Y parameters in a single G0/G1 line.
    /// Non-G0/G1 lines are returned unchanged.
    /// </summary>
    public static string OffsetLine(string line, double dx, double dy)
    {
        var trimmed = line.TrimStart();
        if (!IsMoveLine(trimmed))
            return line;

        // Split command from inline comment
        var commentStart = line.IndexOf(';');
        var cmdPart = commentStart >= 0 ? line[..commentStart] : line;
        var commentPart = commentStart >= 0 ? line[commentStart..] : "";

        var tokens = cmdPart.Split(' ', StringSplitOptions.RemoveEmptyEntries);
        var sb = new StringBuilder();

        for (var i = 0; i < tokens.Length; i++)
        {
            if (i > 0) sb.Append(' ');

            var token = tokens[i];
            if (token.Length >= 2)
            {
                var axis = char.ToUpperInvariant(token[0]);
                if (axis == 'X' && double.TryParse(token.AsSpan(1), NumberStyles.Float, IC, out var xVal))
                {
                    sb.Append('X').Append((xVal + dx).ToString("F3", IC));
                    continue;
                }
                if (axis == 'Y' && double.TryParse(token.AsSpan(1), NumberStyles.Float, IC, out var yVal))
                {
                    sb.Append('Y').Append((yVal + dy).ToString("F3", IC));
                    continue;
                }
            }
            sb.Append(token);
        }

        sb.Append(commentPart);
        return sb.ToString();
    }

    private static bool IsMoveLine(string trimmedLine)
    {
        // Match exactly G0/G1/G00/G01 followed by whitespace or end-of-line.
        // Must NOT match G10, G11, G17, G28, etc.
        if (trimmedLine.Length < 2) return false;
        if (trimmedLine[0] is not 'G' and not 'g') return false;

        // Try "G0" or "G1"
        if (trimmedLine[1] is '0' or '1')
        {
            if (trimmedLine.Length == 2) return true;                      // "G0" or "G1" alone
            if (trimmedLine[2] is ' ' or '\t') return true;                // "G0 ..." or "G1 ..."
            // "G00" or "G01" (leading-zero variant)
            if (trimmedLine[1] == '0' && trimmedLine[2] == '0')            // G00
                return trimmedLine.Length == 3 || trimmedLine[3] is ' ' or '\t';
            if (trimmedLine[1] == '0' && trimmedLine[2] == '1')            // G01
                return trimmedLine.Length == 3 || trimmedLine[3] is ' ' or '\t';
        }
        return false;
    }
}
