namespace HybridSlicer.Infrastructure.Slicing.MultiExtruder;

/// <summary>
/// A planned tool change at a specific point in the section list.
/// </summary>
public sealed class PlannedToolChange
{
    /// <summary>Index into the section list where this tool change happens (before the section).</summary>
    public required int BeforeSectionIndex { get; init; }

    /// <summary>Extruder we're switching FROM.</summary>
    public required int FromExtruder { get; init; }

    /// <summary>Extruder we're switching TO.</summary>
    public required int ToExtruder { get; init; }

    /// <summary>The Cura feature type that triggered this change.</summary>
    public required string TriggerFeature { get; init; }
}

/// <summary>
/// Plans where tool changes need to be inserted given a sequence of G-code sections
/// and a feature→extruder mapping. Does not modify G-code — produces a plan only.
/// </summary>
public static class ToolChangePlanner
{
    /// <summary>
    /// Walks the section list and produces an ordered list of tool changes.
    /// A change is emitted whenever the required extruder for a section differs
    /// from the currently active extruder.
    /// </summary>
    public static List<PlannedToolChange> Plan(
        IReadOnlyList<GCodeSection> sections,
        ExtruderDutyMapper mapper)
    {
        var changes = new List<PlannedToolChange>();
        var activeExtruder = 0; // start on E0

        for (var i = 0; i < sections.Count; i++)
        {
            var target = mapper.GetExtruderForFeature(sections[i].Feature);
            if (target != activeExtruder)
            {
                changes.Add(new PlannedToolChange
                {
                    BeforeSectionIndex = i,
                    FromExtruder = activeExtruder,
                    ToExtruder = target,
                    TriggerFeature = sections[i].Feature,
                });
                activeExtruder = target;
            }
        }

        return changes;
    }
}
