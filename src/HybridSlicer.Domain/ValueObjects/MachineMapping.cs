namespace HybridSlicer.Domain.ValueObjects;

/// <summary>
/// Defines how the machine's coordinate system origin relates to the bed.
/// </summary>
public enum OriginMode
{
    /// <summary>Machine (0,0) is at the front-left corner of the bed.</summary>
    BedFrontLeft = 0,

    /// <summary>Machine (0,0) is at the center of the bed.</summary>
    BedCenter = 1,
}

/// <summary>
/// Complete unified mapping of a machine's coordinate system, bed, and extruder layout.
///
/// All positions are in millimetres. The reference frame is:
///   X = left→right (machine width axis)
///   Y = front→back (machine depth axis)
///   Z = bottom→top (machine height axis, 0 = bed surface, positive = up)
///
/// This object is computed from MachineProfile fields and provides a single
/// consistent view that the slicer, preview, and G-code pipeline all consume.
/// </summary>
public sealed class MachineMapping
{
    // ── Machine travel ────────────────────────────────────────────────────────
    /// <summary>Total X travel in mm.</summary>
    public double TravelXMm { get; init; }

    /// <summary>Total Y travel in mm.</summary>
    public double TravelYMm { get; init; }

    /// <summary>Total Z travel in mm.</summary>
    public double TravelZMm { get; init; }

    // ── Origin ────────────────────────────────────────────────────────────────
    /// <summary>Where machine (0,0) is relative to the bed.</summary>
    public OriginMode Origin { get; init; }

    // ── Bed / build area ──────────────────────────────────────────────────────
    /// <summary>Printable width (X) in mm.</summary>
    public double BedWidthMm { get; init; }

    /// <summary>Printable depth (Y) in mm.</summary>
    public double BedDepthMm { get; init; }

    /// <summary>Maximum printable height (Z) in mm.</summary>
    public double BedHeightMm { get; init; }

    /// <summary>
    /// Bed front-left corner position in machine coordinates.
    /// For BedCenter origin this is (-BedWidth/2, -BedDepth/2).
    /// For BedFrontLeft origin this is (0, 0).
    /// </summary>
    public double BedOriginX { get; init; }
    public double BedOriginY { get; init; }

    /// <summary>Bed center in machine coordinates.</summary>
    public double BedCenterX { get; init; }
    public double BedCenterY { get; init; }

    // ── Print reference origin ────────────────────────────────────────────────
    /// <summary>
    /// The coordinate that the slicer uses as (0,0) for the print.
    /// With machine_center_is_zero=true this equals bed center.
    /// </summary>
    public double PrintOriginX { get; init; }
    public double PrintOriginY { get; init; }

    // ── Extruders ─────────────────────────────────────────────────────────────
    /// <summary>Number of extruders.</summary>
    public int ExtruderCount { get; init; }

    /// <summary>
    /// Absolute position of each extruder nozzle in machine coordinates,
    /// computed from cumulative X/Y offsets. E0 is at (E0X, E0Y),
    /// E1 at (E0X + NozzleXOffsets[0], E0Y + NozzleYOffsets[0]), etc.
    ///
    /// E0 position = bed front-left corner + (FrontBedEdgeOffset, LeftBedEdgeOffset).
    /// </summary>
    public IReadOnlyList<(double X, double Y)> ExtruderPositions { get; init; } = [];

    /// <summary>
    /// Extruder-to-duty assignments (e.g. E0=Walls, E1=Support).
    /// </summary>
    public IReadOnlyList<(int ExtruderIndex, string Duty)> DutyAssignments { get; init; } = [];

    // ── Bed edge offsets (kept for backward compat) ───────────────────────────
    public double LeftBedEdgeOffsetMm { get; init; }
    public double RightBedEdgeOffsetMm { get; init; }
    public double FrontBedEdgeOffsetMm { get; init; }
    public double BackBedEdgeOffsetMm { get; init; }
}
