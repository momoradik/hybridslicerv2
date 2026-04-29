using HybridSlicer.Application.Interfaces;
using HybridSlicer.Domain.Entities;
using HybridSlicer.Infrastructure.Slicing.MultiExtruder;
using Microsoft.Extensions.Logging;

namespace HybridSlicer.Infrastructure.Slicing;

/// <summary>
/// Orchestrates the multi-extruder G-code post-processing pipeline.
///
/// Pipeline stages (each is a separate testable module):
///   1. GCodeFeatureParser     — splits raw G-code into header, typed feature sections, footer
///   2. ExtruderDutyMapper     — maps Cura feature types to extruder indices from machine profile
///   3. ToolChangePlanner      — determines where tool changes are needed in the section sequence
///   4. NozzleOffsetTable      — computes cumulative X/Y offsets per extruder from machine profile
///   5. CoordinateOffsetApplicator — adjusts G0/G1 XY coordinates for the active nozzle position
///   6. MultiExtruderGCodeEmitter  — assembles the final output from all the above
///
/// Bypass conditions (no processing, file unchanged):
///   - Machine has 1 extruder
///   - No extruder duty assignments configured
///   - All features map to the same extruder (no tool changes needed)
/// </summary>
public sealed class MultiExtruderPostProcessor : IMultiExtruderPostProcessor
{
    private readonly ILogger<MultiExtruderPostProcessor> _logger;

    public MultiExtruderPostProcessor(ILogger<MultiExtruderPostProcessor> logger)
        => _logger = logger;

    public async Task ProcessAsync(
        string gcodePath,
        MachineProfile machine,
        IReadOnlyList<CustomGCodeBlock> customBlocks,
        CancellationToken ct = default)
    {
        // ── Bypass: single extruder ──────────────────────────────────────────
        if (machine.ExtruderCount <= 1)
            return;

        // ── Bypass: no duty assignments ──────────────────────────────────────
        var assignments = machine.ExtruderAssignments;
        if (assignments.Count == 0)
        {
            _logger.LogDebug("Skipping multi-extruder post-processing: no duty assignments");
            return;
        }

        // ── Stage 1: Build extruder duty mapper (validates assignments) ─────
        // This throws DomainException if any assignment references a non-existent extruder.
        var mapper = ExtruderDutyMapper.FromAssignments(assignments, machine.ExtruderCount);

        // ── Bypass: all features on same extruder ────────────────────────────
        if (!mapper.RequiresToolChanges)
        {
            _logger.LogDebug("Skipping multi-extruder post-processing: all features map to same extruder");
            return;
        }

        // ── Stage 2: Compute nozzle offset table ─────────────────────────────
        var offsets = NozzleOffsetTable.FromMachineProfile(machine);

        _logger.LogInformation(
            "Multi-extruder post-processing: {Extruders} extruders, applying feature-to-extruder mapping",
            machine.ExtruderCount);
        foreach (var line in mapper.GetMappingSummary())
            _logger.LogInformation("  Duty mapping: {Mapping}", line);

        // ── Stage 3: Parse G-code into structured sections ───────────────────
        var rawGCode = await File.ReadAllTextAsync(gcodePath, ct);
        var parsedFile = GCodeFeatureParser.Parse(rawGCode);

        _logger.LogDebug(
            "Parsed G-code: {Header} header lines, {Sections} feature sections, {Footer} footer lines",
            parsedFile.Header.Count, parsedFile.Sections.Count, parsedFile.Footer.Count);

        if (parsedFile.Sections.Count == 0)
        {
            _logger.LogWarning("No feature sections found in G-code — skipping post-processing");
            return;
        }

        // ── Stage 4: Plan tool changes ───────────────────────────────────────
        var toolChanges = ToolChangePlanner.Plan(parsedFile.Sections, mapper);

        _logger.LogInformation(
            "Tool change plan: {Changes} changes across {Sections} sections",
            toolChanges.Count, parsedFile.Sections.Count);

        if (toolChanges.Count == 0)
        {
            // All sections happened to use the same extruder despite the mapping having variety
            _logger.LogDebug("No tool changes needed for this specific G-code — file unchanged");
            return;
        }

        // ── Stage 5: Emit final multi-extruder G-code ────────────────────────
        var output = MultiExtruderGCodeEmitter.Emit(parsedFile, toolChanges, offsets, mapper, customBlocks);

        await File.WriteAllTextAsync(gcodePath, output, ct);

        _logger.LogInformation(
            "Multi-extruder G-code written: {Path} ({ToolChanges} tool changes)",
            gcodePath, toolChanges.Count);
    }
}
