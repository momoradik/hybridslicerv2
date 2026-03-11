using HybridSlicer.Domain.Enums;
using HybridSlicer.Domain.Exceptions;

namespace HybridSlicer.Domain.Entities;

/// <summary>
/// A user-defined reusable G-code snippet that fires at a configured trigger
/// point in the hybrid process (e.g., before every machining operation).
/// </summary>
public class CustomGCodeBlock
{
    public Guid Id { get; private set; }
    public string Name { get; private set; } = string.Empty;
    public string GCodeContent { get; private set; } = string.Empty;
    public GCodeTrigger Trigger { get; private set; }
    public string? Description { get; private set; }
    public bool IsEnabled { get; private set; } = true;
    public int SortOrder { get; private set; }
    public DateTime CreatedAt { get; private set; }
    public DateTime UpdatedAt { get; private set; }

    private CustomGCodeBlock() { }

    public static CustomGCodeBlock Create(string name, string gcode, GCodeTrigger trigger, int sortOrder = 0)
    {
        if (string.IsNullOrWhiteSpace(name))
            throw new DomainException("INVALID_NAME", "G-code block name must not be empty.");
        if (string.IsNullOrWhiteSpace(gcode))
            throw new DomainException("INVALID_GCODE", "G-code content must not be empty.");

        return new CustomGCodeBlock
        {
            Id = Guid.NewGuid(),
            Name = name.Trim(),
            GCodeContent = gcode,
            Trigger = trigger,
            SortOrder = sortOrder,
            CreatedAt = DateTime.UtcNow,
            UpdatedAt = DateTime.UtcNow
        };
    }

    public void Update(string name, string gcode, GCodeTrigger trigger, string? description, int sortOrder)
    {
        Name = name.Trim();
        GCodeContent = gcode;
        Trigger = trigger;
        Description = description;
        SortOrder = sortOrder;
        UpdatedAt = DateTime.UtcNow;
    }

    public void Enable() { IsEnabled = true; UpdatedAt = DateTime.UtcNow; }
    public void Disable() { IsEnabled = false; UpdatedAt = DateTime.UtcNow; }
}
