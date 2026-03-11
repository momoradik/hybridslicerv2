namespace HybridSlicer.Application.Common;

/// <summary>
/// Configuration for the local file-system storage root.
/// Bound from "Storage" section in appsettings.json.
/// Handlers receive this via IOptions&lt;StorageOptions&gt;.
/// </summary>
public sealed class StorageOptions
{
    public const string Section = "Storage";

    /// <summary>Absolute path to the root directory for jobs, logs, and temp files.</summary>
    public string Root { get; set; } = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
        "HybridSlicer");
}
