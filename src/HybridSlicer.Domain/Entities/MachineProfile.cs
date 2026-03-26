using HybridSlicer.Domain.Enums;
using HybridSlicer.Domain.Exceptions;
using HybridSlicer.Domain.ValueObjects;

namespace HybridSlicer.Domain.Entities;

public class MachineProfile
{
    public Guid Id { get; private set; }
    public string Name { get; private set; } = string.Empty;
    public MachineType Type { get; private set; }

    // Build volume (mm)
    public double BedWidthMm { get; private set; }
    public double BedDepthMm { get; private set; }
    public double BedHeightMm { get; private set; }

    // FDM properties
    public double NozzleDiameterMm { get; private set; }
    public int ExtruderCount { get; private set; }

    // Network communication
    public string? IpAddress { get; private set; }
    public int Port { get; private set; }

    // CNC coordinate offset relative to the printer origin
    public MachineOffset CncOffset { get; private set; } = MachineOffset.Zero;

    // Per-tool length and radius offsets (tool index → offset)
    private readonly List<ToolOffset> _toolOffsets = [];
    public IReadOnlyList<ToolOffset> ToolOffsets => _toolOffsets.AsReadOnly();

    // Rapid travel clearance height above part for CNC moves
    public double SafeClearanceHeightMm { get; private set; } = 5.0;

    // Versioning / audit
    public string Version { get; private set; } = "1.0";
    public DateTime CreatedAt { get; private set; }
    public DateTime UpdatedAt { get; private set; }
    public bool IsDeleted { get; private set; }

    // EF Core constructor
    private MachineProfile() { }

    public static MachineProfile Create(
        string name,
        MachineType type,
        double bedWidth,
        double bedDepth,
        double bedHeight,
        double nozzleDiameter = 0.4,
        int extruderCount = 1)
    {
        if (string.IsNullOrWhiteSpace(name))
            throw new DomainException("INVALID_NAME", "Machine profile name must not be empty.");
        if (bedWidth <= 0 || bedDepth <= 0 || bedHeight <= 0)
            throw new DomainException("INVALID_DIMENSIONS", "Bed dimensions must be positive.");

        return new MachineProfile
        {
            Id = Guid.NewGuid(),
            Name = name.Trim(),
            Type = type,
            BedWidthMm = bedWidth,
            BedDepthMm = bedDepth,
            BedHeightMm = bedHeight,
            NozzleDiameterMm = nozzleDiameter,
            ExtruderCount = extruderCount,
            CreatedAt = DateTime.UtcNow,
            UpdatedAt = DateTime.UtcNow
        };
    }

    public void SetNetworkEndpoint(string ipAddress, int port)
    {
        if (string.IsNullOrWhiteSpace(ipAddress))
            throw new DomainException("INVALID_IP", "IP address must not be empty.");
        if (port is < 1 or > 65535)
            throw new DomainException("INVALID_PORT", $"Port {port} is out of range.");

        IpAddress = ipAddress.Trim();
        Port = port;
        Touch();
    }

    public void UpdateCncOffset(MachineOffset offset)
    {
        CncOffset = offset ?? throw new ArgumentNullException(nameof(offset));
        Touch();
    }

    public void SetSafeClearanceHeight(double heightMm)
    {
        if (heightMm <= 0)
            throw new DomainException("INVALID_CLEARANCE", "Safe clearance height must be positive.");
        SafeClearanceHeightMm = heightMm;
        Touch();
    }

    public void UpsertToolOffset(ToolOffset toolOffset)
    {
        ArgumentNullException.ThrowIfNull(toolOffset);
        var existing = _toolOffsets.FindIndex(t => t.ToolIndex == toolOffset.ToolIndex);
        if (existing >= 0)
            _toolOffsets[existing] = toolOffset;
        else
            _toolOffsets.Add(toolOffset);
        Touch();
    }

    public void Rename(string name)
    {
        if (string.IsNullOrWhiteSpace(name))
            throw new DomainException("INVALID_NAME", "Machine profile name must not be empty.");
        Name = name.Trim();
        Touch();
    }

    public void SoftDelete()
    {
        IsDeleted = true;
        Touch();
    }

    private void Touch() => UpdatedAt = DateTime.UtcNow;
}
