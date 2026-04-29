using HybridSlicer.Domain.Entities;

namespace HybridSlicer.Application.Interfaces;

/// <summary>
/// Translates G-code coordinates from the internal bed-centre reference frame
/// to the real machine coordinate frame using origin and bed position.
/// No-op when the machine origin is at bed centre.
/// </summary>
public interface IMachineCoordinateTranslator
{
    Task TranslateAsync(string gcodePath, MachineProfile machine, CancellationToken ct = default);
}
