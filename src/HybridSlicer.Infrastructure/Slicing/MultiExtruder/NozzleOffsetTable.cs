using HybridSlicer.Domain.Entities;

namespace HybridSlicer.Infrastructure.Slicing.MultiExtruder;

/// <summary>
/// Holds the computed absolute X/Y nozzle position for each extruder, relative to E0.
/// E0 is always at (0, 0). Subsequent extruders accumulate from X/Y offset arrays.
/// </summary>
public sealed class NozzleOffsetTable
{
    private readonly (double X, double Y)[] _offsets;

    public int ExtruderCount => _offsets.Length;

    private NozzleOffsetTable((double X, double Y)[] offsets) => _offsets = offsets;

    /// <summary>
    /// Builds the offset table from a machine profile's nozzle X/Y offset lists.
    /// </summary>
    public static NozzleOffsetTable FromMachineProfile(MachineProfile machine)
    {
        var count = machine.ExtruderCount;
        var offsets = new (double X, double Y)[count];
        offsets[0] = (0, 0);

        var xList = machine.NozzleXOffsets;
        var yList = machine.NozzleYOffsets;

        double cumX = 0, cumY = 0;
        for (var i = 0; i < count - 1; i++)
        {
            cumX += i < xList.Count ? xList[i] : 0;
            cumY += i < yList.Count ? yList[i] : 0;
            offsets[i + 1] = (cumX, cumY);
        }

        return new NozzleOffsetTable(offsets);
    }

    /// <summary>Gets the absolute physical (X, Y) offset for a given extruder relative to E0.</summary>
    public (double X, double Y) GetPhysicalOffset(int extruderIndex)
        => extruderIndex >= 0 && extruderIndex < _offsets.Length
            ? _offsets[extruderIndex]
            : (0, 0);

    /// <summary>
    /// Computes the coordinate compensation to apply to G-code when extruder N is active.
    ///
    /// Cura generates all XY coordinates targeting the part's intended position, assuming
    /// the nozzle is at the machine origin (E0 position). When a different extruder is
    /// active, its nozzle is physically offset from E0. To make it deposit material at
    /// the same intended part position, we must shift the commanded coordinates by the
    /// NEGATIVE of the physical offset.
    ///
    /// Example: E1 is 30mm to the right of E0 on Y axis.
    ///   - Cura says "print wall at Y=50" (targeting part geometry at Y=50)
    ///   - E1's nozzle is already 30mm further in Y than E0
    ///   - So we command Y=50-30=20, which makes E1's nozzle arrive at Y=50
    ///
    /// Returns: (-physicalOffset.X, -physicalOffset.Y)
    /// For E0 this is always (0, 0) — no adjustment needed.
    /// </summary>
    public (double DeltaX, double DeltaY) GetCompensationForExtruder(int extruderIndex)
    {
        var phys = GetPhysicalOffset(extruderIndex);
        return (-phys.X, -phys.Y);
    }

    /// <summary>Returns a summary string for G-code header comments.</summary>
    public IEnumerable<string> ToCommentLines()
    {
        for (var i = 0; i < _offsets.Length; i++)
            yield return $"; E{i} nozzle offset: X={_offsets[i].X:F3} Y={_offsets[i].Y:F3}";
    }
}
