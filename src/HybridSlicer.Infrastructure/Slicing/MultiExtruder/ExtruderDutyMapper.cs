using HybridSlicer.Domain.Entities;
using HybridSlicer.Domain.Exceptions;

namespace HybridSlicer.Infrastructure.Slicing.MultiExtruder;

/// <summary>
/// Maps Cura G-code feature types to extruder indices based on machine profile duty assignments.
///
/// Duty → Cura features:
///   "Walls"   → WALL-OUTER, WALL-INNER, SKIN (perimeters and top/bottom surfaces)
///   "Infill"  → FILL (sparse infill)
///   "Support" → SUPPORT, SUPPORT-INTERFACE
///   "All"     → fallback for all feature types (lowest priority)
///
/// Priority: specific duties take precedence over "All". First assignment wins for each feature.
/// </summary>
public sealed class ExtruderDutyMapper
{
    private readonly Dictionary<string, int> _featureToExtruder;
    private readonly int _defaultExtruder;

    private ExtruderDutyMapper(Dictionary<string, int> map, int defaultExtruder)
    {
        _featureToExtruder = map;
        _defaultExtruder = defaultExtruder;
    }

    /// <summary>
    /// Builds a mapper from the machine profile's extruder assignments.
    /// Validates that all referenced extruder indices are within range.
    /// </summary>
    /// <exception cref="DomainException">Thrown when an assignment references a non-existent extruder.</exception>
    public static ExtruderDutyMapper FromAssignments(IReadOnlyList<ExtruderAssignment> assignments, int extruderCount)
    {
        // Validate: all assignments must reference valid extruder indices
        foreach (var a in assignments)
        {
            if (a.ExtruderIndex < 0 || a.ExtruderIndex >= extruderCount)
                throw new DomainException("INVALID_EXTRUDER_ASSIGNMENT",
                    $"Duty '{a.Duty}' is assigned to extruder {a.ExtruderIndex}, " +
                    $"but the machine only has {extruderCount} extruder(s) (valid indices: 0–{extruderCount - 1}). " +
                    $"Fix the extruder duty assignments in Machine Configuration.");
        }

        var map = new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase);
        var defaultExtruder = 0;

        // Process specific duties first, then "All" as fallback
        var ordered = assignments
            .OrderBy(a => a.Duty.Equals("All", StringComparison.OrdinalIgnoreCase) ? 1 : 0)
            .ThenBy(a => a.ExtruderIndex);

        foreach (var a in ordered)
        {
            switch (a.Duty.ToUpperInvariant())
            {
                case "WALLS":
                    map.TryAdd("WALL-OUTER", a.ExtruderIndex);
                    map.TryAdd("WALL-INNER", a.ExtruderIndex);
                    map.TryAdd("SKIN", a.ExtruderIndex);
                    break;
                case "SUPPORT":
                    map.TryAdd("SUPPORT", a.ExtruderIndex);
                    map.TryAdd("SUPPORT-INTERFACE", a.ExtruderIndex);
                    break;
                case "INFILL":
                    map.TryAdd("FILL", a.ExtruderIndex);
                    break;
                case "ALL":
                    defaultExtruder = a.ExtruderIndex;
                    map.TryAdd("WALL-OUTER", a.ExtruderIndex);
                    map.TryAdd("WALL-INNER", a.ExtruderIndex);
                    map.TryAdd("SKIN", a.ExtruderIndex);
                    map.TryAdd("FILL", a.ExtruderIndex);
                    map.TryAdd("SUPPORT", a.ExtruderIndex);
                    map.TryAdd("SUPPORT-INTERFACE", a.ExtruderIndex);
                    map.TryAdd("SKIRT", a.ExtruderIndex);
                    break;
            }
        }

        return new ExtruderDutyMapper(map, defaultExtruder);
    }

    /// <summary>
    /// Returns the extruder index that should print the given feature type.
    /// </summary>
    public int GetExtruderForFeature(string curaFeatureType)
        => _featureToExtruder.TryGetValue(curaFeatureType, out var idx) ? idx : _defaultExtruder;

    /// <summary>
    /// Returns true if there are actually multiple extruders in use (i.e. at least two
    /// different features map to different extruders). If all features map to the same
    /// extruder, no tool changes are needed.
    /// </summary>
    public bool RequiresToolChanges
    {
        get
        {
            var indices = new HashSet<int>(_featureToExtruder.Values) { _defaultExtruder };
            return indices.Count > 1;
        }
    }

    /// <summary>
    /// Returns a human-readable summary of all feature→extruder mappings for diagnostics.
    /// </summary>
    public IEnumerable<string> GetMappingSummary()
    {
        foreach (var (feature, extruder) in _featureToExtruder.OrderBy(kv => kv.Value))
            yield return $"{feature} → E{extruder}";
        yield return $"(default) → E{_defaultExtruder}";
    }
}
