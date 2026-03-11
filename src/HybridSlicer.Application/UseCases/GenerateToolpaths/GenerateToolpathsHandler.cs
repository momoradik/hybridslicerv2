using HybridSlicer.Application.Interfaces;
using HybridSlicer.Application.Interfaces.Repositories;
using HybridSlicer.Domain.Enums;
using HybridSlicer.Domain.Exceptions;
using MediatR;
using Microsoft.Extensions.Logging;

namespace HybridSlicer.Application.UseCases.GenerateToolpaths;

public sealed class GenerateToolpathsHandler : IRequestHandler<GenerateToolpathsCommand, GenerateToolpathsResult>
{
    private readonly IPrintJobRepository _jobs;
    private readonly IPrintProfileRepository _printProfiles;
    private readonly IMachineProfileRepository _machines;
    private readonly ICncToolRepository _tools;
    private readonly IToolpathPlanner _planner;
    private readonly ISafetyValidator _safety;
    private readonly ILogger<GenerateToolpathsHandler> _logger;

    public GenerateToolpathsHandler(
        IPrintJobRepository jobs,
        IPrintProfileRepository printProfiles,
        IMachineProfileRepository machines,
        ICncToolRepository tools,
        IToolpathPlanner planner,
        ISafetyValidator safety,
        ILogger<GenerateToolpathsHandler> logger)
    {
        _jobs = jobs;
        _printProfiles = printProfiles;
        _machines = machines;
        _tools = tools;
        _planner = planner;
        _safety = safety;
        _logger = logger;
    }

    public async Task<GenerateToolpathsResult> Handle(GenerateToolpathsCommand cmd, CancellationToken ct)
    {
        var job = await _jobs.GetByIdAsync(cmd.JobId, ct)
            ?? throw new DomainException("JOB_NOT_FOUND", $"Job {cmd.JobId} not found.");

        if (job.TotalPrintLayers is null)
            throw new DomainException("NOT_SLICED", "Job must be sliced before toolpaths can be generated.");

        var machine = await _machines.GetByIdAsync(job.MachineProfileId, ct)
            ?? throw new DomainException("MACHINE_NOT_FOUND", $"Machine profile {job.MachineProfileId} not found.");

        var tool = await _tools.GetByIdAsync(cmd.CncToolId, ct)
            ?? throw new DomainException("TOOL_NOT_FOUND", $"CNC tool {cmd.CncToolId} not found.");

        var profile = await _printProfiles.GetByIdAsync(job.PrintProfileId, ct)
            ?? throw new DomainException("PROFILE_NOT_FOUND", $"Print profile {job.PrintProfileId} not found.");

        job.AssignCncTool(cmd.CncToolId);
        job.MarkGeneratingToolpaths();
        await _jobs.UpdateAsync(job, ct);

        var machinedLayers = new List<int>();

        try
        {
            for (var layer = cmd.MachineEveryNLayers;
                 layer <= job.TotalPrintLayers;
                 layer += cmd.MachineEveryNLayers)
            {
                var zHeight = layer * profile.LayerHeightMm;

                _logger.LogDebug("Planning toolpath for job {JobId} layer {Layer} Z={Z}", cmd.JobId, layer, zHeight);

                var toolpathRequest = new ToolpathRequest(
                    StlFilePath:           job.StlFilePath,
                    ZHeightMm:             zHeight,
                    ToolDiameterMm:        tool.DiameterMm,
                    MaxDepthOfCutMm:       tool.MaxDepthOfCutMm,
                    FeedRateMmPerMin:      tool.RecommendedFeedMmPerMin,
                    SpindleRpm:            tool.RecommendedRpm,
                    MachineOffset:         machine.CncOffset,
                    SafeClearanceHeightMm: machine.SafeClearanceHeightMm);

                var toolpath = await _planner.PlanContourAsync(toolpathRequest, ct);

                if (toolpath.IsEmpty)
                {
                    _logger.LogDebug("No geometry at layer {Layer} — skipping CNC step", layer);
                    continue;
                }

                // Safety validation — all checks must pass before the step is accepted
                var safetyReq = new SafetyValidationRequest(
                    CncGCode:               toolpath.GCode,
                    PrintedGeometryBounds:  [],   // Replaced with real geometry in Phase 7
                    MachineMaxX:            machine.BedWidthMm,
                    MachineMaxY:            machine.BedDepthMm,
                    MachineMaxZ:            machine.BedHeightMm,
                    SafeClearanceHeightMm:  machine.SafeClearanceHeightMm,
                    ToolRadiusMm:           tool.RadiusMm);

                var validation = await _safety.ValidateToolpathAsync(safetyReq, ct);

                if (validation.Status == SafetyStatus.Blocked)
                    throw new SafetyException(
                        $"Layer {layer}: {string.Join("; ", validation.Issues)}");

                if (validation.Status == SafetyStatus.Warning)
                    _logger.LogWarning("Safety WARNING at layer {Layer}: {Issues}",
                        layer, string.Join("; ", validation.Issues));

                machinedLayers.Add(layer);
                _logger.LogInformation("Toolpath OK — layer {Layer} [{Status}]", layer, validation.Status);
            }

            job.MarkToolpathsComplete();
            await _jobs.UpdateAsync(job, ct);

            _logger.LogInformation("Toolpath generation complete for job {JobId}: {Count} layers",
                cmd.JobId, machinedLayers.Count);

            return new GenerateToolpathsResult(cmd.JobId, machinedLayers.Count, machinedLayers);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Toolpath generation failed for job {JobId}", cmd.JobId);
            job.MarkFailed(ex.Message);
            await _jobs.UpdateAsync(job, ct);
            throw;
        }
    }
}
