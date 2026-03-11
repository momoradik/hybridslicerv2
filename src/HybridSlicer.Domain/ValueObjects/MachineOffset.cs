namespace HybridSlicer.Domain.ValueObjects;

/// <summary>
/// Positional and rotational offset for a machine axis or tool.
/// All values are in millimetres; rotation values in degrees.
/// </summary>
public sealed record MachineOffset(
    double X = 0,
    double Y = 0,
    double Z = 0,
    double RotationDeg = 0)
{
    public static readonly MachineOffset Zero = new();

    public bool IsZero => X == 0 && Y == 0 && Z == 0 && RotationDeg == 0;

    public Coordinate3D Apply(Coordinate3D point)
    {
        // Basic translation — rotation applied separately in toolpath planner
        return point.Translate(X, Y, Z);
    }
}
