using HybridSlicer.Domain.Entities;

namespace HybridSlicer.Application.Interfaces;

/// <summary>
/// Post-processes single-extruder G-code from CuraEngine to produce multi-extruder
/// output by detecting feature sections (;TYPE: comments) and mapping them to
/// extruders based on the machine profile's extruder duty assignments.
///
/// Also injects per-extruder custom G-code blocks (BeforeExtruderN / AfterExtruderN)
/// at each tool-change boundary.
///
/// If the machine has only 1 extruder, returns the input unchanged.
/// </summary>
public interface IMultiExtruderPostProcessor
{
    /// <summary>
    /// Processes the G-code file in place.
    /// </summary>
    /// <param name="gcodePath">Path to the G-code file to process.</param>
    /// <param name="machine">Machine profile with extruder config.</param>
    /// <param name="customBlocks">All enabled custom G-code blocks (filtered by trigger internally).</param>
    /// <param name="ct">Cancellation token.</param>
    Task ProcessAsync(
        string gcodePath,
        MachineProfile machine,
        IReadOnlyList<CustomGCodeBlock> customBlocks,
        CancellationToken ct = default);
}
