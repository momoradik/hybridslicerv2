namespace HybridSlicer.Domain.ValueObjects;

/// <summary>
/// Immutable 3-D coordinate in millimetres.
/// </summary>
public sealed record Coordinate3D(double X, double Y, double Z)
{
    public static readonly Coordinate3D Zero = new(0, 0, 0);

    public double DistanceTo(Coordinate3D other)
    {
        var dx = X - other.X;
        var dy = Y - other.Y;
        var dz = Z - other.Z;
        return Math.Sqrt(dx * dx + dy * dy + dz * dz);
    }

    public Coordinate3D Translate(double dx, double dy, double dz)
        => new(X + dx, Y + dy, Z + dz);

    public override string ToString() => $"({X:F4}, {Y:F4}, {Z:F4})";
}
