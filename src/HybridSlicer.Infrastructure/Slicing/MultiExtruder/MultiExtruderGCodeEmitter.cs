using System.Text;
using HybridSlicer.Domain.Entities;
using HybridSlicer.Domain.Enums;

namespace HybridSlicer.Infrastructure.Slicing.MultiExtruder;

/// <summary>
/// Assembles the final multi-extruder G-code from parsed sections, planned tool changes,
/// and offset-adjusted coordinates.
///
/// Output structure:
///   [header from metadata comments]
///   [original header from Cura (startup/homing/heating)]
///   [sections with tool changes and offsets applied]
///   [original footer from Cura (end G-code)]
/// </summary>
public static class MultiExtruderGCodeEmitter
{
    /// <summary>
    /// Emits the final multi-extruder G-code string.
    /// </summary>
    public static string Emit(
        ParsedGCodeFile parsedFile,
        IReadOnlyList<PlannedToolChange> toolChanges,
        NozzleOffsetTable offsets,
        ExtruderDutyMapper mapper,
        IReadOnlyList<CustomGCodeBlock> customBlocks)
    {
        // Build lookup: extruder index → before/after blocks
        var beforeBlocks = new Dictionary<int, List<CustomGCodeBlock>>();
        var afterBlocks = new Dictionary<int, List<CustomGCodeBlock>>();
        foreach (var b in customBlocks.Where(b => b.IsEnabled).OrderBy(b => b.SortOrder))
        {
            var trigger = (int)b.Trigger;
            if (trigger is >= 100 and <= 107) // BeforeExtruderN
            {
                var idx = trigger - 100;
                if (!beforeBlocks.ContainsKey(idx)) beforeBlocks[idx] = [];
                beforeBlocks[idx].Add(b);
            }
            else if (trigger is >= 200 and <= 207) // AfterExtruderN
            {
                var idx = trigger - 200;
                if (!afterBlocks.ContainsKey(idx)) afterBlocks[idx] = [];
                afterBlocks[idx].Add(b);
            }
        }
        var sb = new StringBuilder();

        // ── Metadata header ──────────────────────────────────────────────────
        sb.AppendLine("; === HybridSlicer Multi-Extruder Output ===");
        sb.AppendLine($"; Extruders: {offsets.ExtruderCount}");
        sb.AppendLine($"; Tool changes: {toolChanges.Count}");
        sb.AppendLine("; Offset convention: coordinates are compensated so each nozzle");
        sb.AppendLine(";   deposits material at the original part position regardless of");
        sb.AppendLine(";   physical nozzle spacing. Compensation = -physical_offset.");
        foreach (var comment in offsets.ToCommentLines())
            sb.AppendLine(comment);
        sb.AppendLine("; ==========================================");
        sb.AppendLine();

        // ── Original Cura header (startup G-code) ────────────────────────────
        foreach (var line in parsedFile.Header)
            sb.AppendLine(line);

        // ── Select initial extruder ──────────────────────────────────────────
        sb.AppendLine();
        sb.AppendLine("T0 ; start with extruder 0");
        EmitCustomBlocks(sb, beforeBlocks, 0, "before");
        sb.AppendLine();

        // ── Process sections ─────────────────────────────────────────────────
        var changesBySection = toolChanges
            .ToLookup(tc => tc.BeforeSectionIndex);

        var activeExtruder = 0;

        for (var i = 0; i < parsedFile.Sections.Count; i++)
        {
            // Insert any tool changes before this section
            if (changesBySection.Contains(i))
            {
                foreach (var tc in changesBySection[i])
                {
                    // "After" blocks for the extruder we're leaving
                    EmitCustomBlocks(sb, afterBlocks, tc.FromExtruder, "after");

                    EmitToolChange(sb, tc, offsets);

                    // "Before" blocks for the extruder we're activating
                    EmitCustomBlocks(sb, beforeBlocks, tc.ToExtruder, "before");

                    activeExtruder = tc.ToExtruder;
                }
            }

            // Get coordinate compensation for active extruder (negative of physical offset)
            var (dx, dy) = offsets.GetCompensationForExtruder(activeExtruder);

            // Emit section lines with offset applied
            var section = parsedFile.Sections[i];
            if (dx != 0 || dy != 0)
            {
                var adjusted = CoordinateOffsetApplicator.ApplyOffset(section.Lines, dx, dy);
                foreach (var line in adjusted)
                    sb.AppendLine(line);
            }
            else
            {
                foreach (var line in section.Lines)
                    sb.AppendLine(line);
            }
        }

        // ── After-blocks for the last active extruder ─────────────────────────
        EmitCustomBlocks(sb, afterBlocks, activeExtruder, "after");

        // ── Return to E0 before footer ───────────────────────────────────────
        if (activeExtruder != 0)
        {
            sb.AppendLine();
            sb.AppendLine($"; --- Return to E0 before end ---");
            sb.AppendLine("T0");
            sb.AppendLine();
        }

        // ── Original Cura footer (end G-code) ────────────────────────────────
        foreach (var line in parsedFile.Footer)
            sb.AppendLine(line);

        return sb.ToString();
    }

    // ── Custom G-code block injection ───────────────────────────────────────

    private static void EmitCustomBlocks(
        StringBuilder sb,
        Dictionary<int, List<CustomGCodeBlock>> blocksByExtruder,
        int extruderIndex,
        string position)
    {
        if (!blocksByExtruder.TryGetValue(extruderIndex, out var blocks) || blocks.Count == 0)
            return;

        foreach (var block in blocks)
        {
            sb.AppendLine($"; --- Custom {position} E{extruderIndex}: '{block.Name}' ---");
            sb.AppendLine(block.GCodeContent);
            sb.AppendLine($"; --- End custom {position} E{extruderIndex} ---");
        }
    }

    // ── Tool-change sequence ─────────────────────────────────────────────────

    private static void EmitToolChange(StringBuilder sb, PlannedToolChange tc, NozzleOffsetTable offsets)
    {
        var toPhysical = offsets.GetPhysicalOffset(tc.ToExtruder);
        var (compX, compY) = offsets.GetCompensationForExtruder(tc.ToExtruder);

        sb.AppendLine();
        sb.AppendLine($"; --- Tool change: T{tc.FromExtruder} → T{tc.ToExtruder} (feature: {tc.TriggerFeature}) ---");
        sb.AppendLine($"; E{tc.ToExtruder} physical offset: X={toPhysical.X:F3} Y={toPhysical.Y:F3}");
        sb.AppendLine($"; Coordinate compensation applied: dX={compX:F3} dY={compY:F3}");
        sb.AppendLine("G92 E0 ; reset E before retract");
        sb.AppendLine("G1 E-2.0 F2400 ; retract filament");
        sb.AppendLine($"T{tc.ToExtruder} ; activate extruder {tc.ToExtruder}");
        sb.AppendLine("G92 E0 ; reset E after tool change");
        sb.AppendLine("G1 E2.0 F2400 ; prime filament");
        sb.AppendLine($"; --- End tool change ---");
        sb.AppendLine();
    }
}
