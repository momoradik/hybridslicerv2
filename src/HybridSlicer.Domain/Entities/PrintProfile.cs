using HybridSlicer.Domain.Exceptions;

namespace HybridSlicer.Domain.Entities;

/// <summary>
/// Complete set of 3-D printing / slicing parameters, matching Cura's
/// major setting categories. All values use SI units (mm, mm/s, °C).
/// </summary>
public class PrintProfile
{
    public Guid Id { get; private set; }
    public string Name { get; private set; } = string.Empty;

    // Layer / line
    public double LayerHeightMm { get; private set; } = 0.2;
    public double LineWidthMm { get; private set; } = 0.4;
    public int WallCount { get; private set; } = 3;
    public int TopBottomLayers { get; private set; } = 4;

    // Speed (mm/s)
    public double PrintSpeedMmS { get; private set; } = 50;
    public double TravelSpeedMmS { get; private set; } = 150;
    public double InfillSpeedMmS { get; private set; } = 70;
    public double WallSpeedMmS { get; private set; } = 30;
    public double FirstLayerSpeedMmS { get; private set; } = 20;

    // Infill
    public double InfillDensityPct { get; private set; } = 20;
    public string InfillPattern { get; private set; } = "grid";

    // Temperature (°C)
    public int PrintTemperatureDegC { get; private set; } = 210;
    public int BedTemperatureDegC { get; private set; } = 60;

    // Retraction
    public double RetractLengthMm { get; private set; } = 5;
    public double RetractSpeedMmS { get; private set; } = 45;

    // Support
    public bool SupportEnabled { get; private set; }
    public string SupportType { get; private set; } = "normal";
    public double SupportOverhangAngleDeg { get; private set; } = 50;

    // Cooling
    public bool CoolingEnabled { get; private set; } = true;
    public int CoolingFanSpeedPct { get; private set; } = 100;

    // Filament
    public double FilamentDiameterMm { get; private set; } = 1.75;

    // Skirt / brim
    public bool BrimEnabled { get; private set; }
    public int BrimLineCount { get; private set; } = 8;

    // Versioning
    public string Version { get; private set; } = "1.0";
    public DateTime CreatedAt { get; private set; }
    public DateTime UpdatedAt { get; private set; }
    public bool IsDeleted { get; private set; }

    private PrintProfile() { }

    public static PrintProfile Create(string name)
    {
        if (string.IsNullOrWhiteSpace(name))
            throw new DomainException("INVALID_NAME", "Print profile name must not be empty.");

        return new PrintProfile
        {
            Id = Guid.NewGuid(),
            Name = name.Trim(),
            CreatedAt = DateTime.UtcNow,
            UpdatedAt = DateTime.UtcNow
        };
    }

    public PrintProfile WithLayerHeight(double mm)
    {
        if (mm is <= 0 or > 1)
            throw new DomainException("INVALID_LAYER_HEIGHT", "Layer height must be between 0 and 1 mm.");
        LayerHeightMm = mm;
        return Touch();
    }

    public PrintProfile WithSpeeds(double print, double travel, double infill, double wall, double firstLayer)
    {
        PrintSpeedMmS = print;
        TravelSpeedMmS = travel;
        InfillSpeedMmS = infill;
        WallSpeedMmS = wall;
        FirstLayerSpeedMmS = firstLayer;
        return Touch();
    }

    public PrintProfile WithTemperatures(int extruder, int bed)
    {
        PrintTemperatureDegC = extruder;
        BedTemperatureDegC = bed;
        return Touch();
    }

    public PrintProfile WithInfill(double densityPct, string pattern)
    {
        if (densityPct is < 0 or > 100)
            throw new DomainException("INVALID_INFILL", "Infill density must be 0–100 %.");
        InfillDensityPct = densityPct;
        InfillPattern = pattern;
        return Touch();
    }

    public PrintProfile WithSupport(bool enabled, string type = "normal", double overhangAngle = 50)
    {
        SupportEnabled = enabled;
        SupportType = type;
        SupportOverhangAngleDeg = overhangAngle;
        return Touch();
    }

    public void SoftDelete() { IsDeleted = true; Touch(); }

    private PrintProfile Touch() { UpdatedAt = DateTime.UtcNow; return this; }
}
