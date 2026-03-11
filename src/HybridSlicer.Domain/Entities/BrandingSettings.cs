namespace HybridSlicer.Domain.Entities;

/// <summary>
/// White-label branding configuration. A single row is maintained (singleton).
/// </summary>
public class BrandingSettings
{
    public Guid Id { get; private set; }
    public string CompanyName { get; private set; } = "HybridSlicer";
    public string AppTitle { get; private set; } = "HybridSlicer";
    public string? LogoUrl { get; private set; }
    public string PrimaryColor { get; private set; } = "#2563EB";   // Tailwind blue-600
    public string AccentColor { get; private set; } = "#7C3AED";    // Tailwind violet-600
    public string? SupportEmail { get; private set; }
    public string? SupportUrl { get; private set; }
    public DateTime UpdatedAt { get; private set; }

    private BrandingSettings() { }

    public static BrandingSettings Default() => new()
    {
        Id = Guid.NewGuid(),
        UpdatedAt = DateTime.UtcNow
    };

    public void Update(
        string companyName,
        string appTitle,
        string primaryColor,
        string accentColor,
        string? logoUrl = null,
        string? supportEmail = null,
        string? supportUrl = null)
    {
        CompanyName = companyName.Trim();
        AppTitle = appTitle.Trim();
        PrimaryColor = primaryColor;
        AccentColor = accentColor;
        LogoUrl = logoUrl;
        SupportEmail = supportEmail;
        SupportUrl = supportUrl;
        UpdatedAt = DateTime.UtcNow;
    }
}
