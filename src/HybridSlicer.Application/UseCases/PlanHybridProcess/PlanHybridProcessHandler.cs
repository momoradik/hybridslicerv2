using HybridSlicer.Application.Common;
using HybridSlicer.Application.Interfaces;
using HybridSlicer.Application.Interfaces.Repositories;
using HybridSlicer.Domain.Enums;
using HybridSlicer.Domain.Exceptions;
using MediatR;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

namespace HybridSlicer.Application.UseCases.PlanHybridProcess;

public sealed class PlanHybridProcessHandler : IRequestHandler<PlanHybridProcessCommand, PlanHybridProcessResult>
{
    private readonly IPrintJobRepository _jobs;
    private readonly IPrintProfileRepository _printProfiles;
    private readonly IMachineProfileRepository _machines;
    private readonly ICncToolRepository _tools;
    private readonly IHybridOrchestrator _orchestrator;
    private readonly ICustomGCodeBlockRepository _blocks;
    private readonly IToolpathPlanner _planner;
    private readonly StorageOptions _storage;
    private readonly ILogger<PlanHybridProcessHandler> _logger;

    public PlanHybridProcessHandler(
        IPrintJobRepository jobs,
        IPrintProfileRepository printProfiles,
        IMachineProfileRepository machines,
        ICncToolRepository tools,
        IHybridOrchestrator orchestrator,
        ICustomGCodeBlockRepository blocks,
        IToolpathPlanner planner,
        IOptions<StorageOptions> storageOpts,
        ILogger<PlanHybridProcessHandler> logger)
    {
        _jobs = jobs;
        _printProfiles = printProfiles;
        _machines = machines;
        _tools = tools;
        _orchestrator = orchestrator;
        _blocks = blocks;
        _planner = planner;
        _storage = storageOpts.Value;
        _logger = logger;
    }

    public async Task<PlanHybridProcessResult> Handle(PlanHybridProcessCommand cmd, CancellationToken ct)
    {
        var job = await _jobs.GetByIdAsync(cmd.JobId, ct)
            ?? throw new DomainException("JOB_NOT_FOUND", $"Job {cmd.JobId} not found.");

        if (job.Status != JobStatus.ToolpathsComplete)
            throw new DomainException("INVALID_STATE",
                $"Job must be in ToolpathsComplete state (current: {job.Status}).");

        if (job.PrintGCodePath is null || job.TotalPrintLayers is null)
            throw new DomainException("MISSING_DATA", "Job has no sliced G-code. Run slice first.");

        if (job.CncToolId is null)
            throw new DomainException("MISSING_TOOL", "No CNC tool assigned to job. Run generate-toolpaths first.");

        var machine = await _machines.GetByIdAsync(job.MachineProfileId, ct)
            ?? throw new DomainException("MACHINE_NOT_FOUND", $"Machine profile {job.MachineProfileId} not found.");

        var tool = await _tools.GetByIdAsync(job.CncToolId.Value, ct)
            ?? throw new DomainException("TOOL_NOT_FOUND", $"CNC tool {job.CncToolId} not found.");

        var profile = await _printProfiles.GetByIdAsync(job.PrintProfileId, ct)
            ?? throw new DomainException("PROFILE_NOT_FOUND", $"Print profile {job.PrintProfileId} not found.");

        var enabledBlocks = await _blocks.GetEnabledAsync(ct);

        job.MarkPlanningHybrid();
        await _jobs.UpdateAsync(job, ct);

        _logger.LogInformation("Building hybrid plan for job {JobId}, machine every {N} layers",
            cmd.JobId, cmd.MachineEveryNLayers);

        try
        {
            // Re-generate per-layer CNC G-code for orchestration
            var cncByLayer = new Dictionary<int, string>();
            for (var layer = cmd.MachineEveryNLayers; layer <= job.TotalPrintLayers; layer += cmd.MachineEveryNLayers)
            {
                var zHeight = layer * profile.LayerHeightMm;
                var toolpathResult = await _planner.PlanContourAsync(new ToolpathRequest(
                    StlFilePath:              job.StlFilePath,
                    ZHeightMm:                zHeight,
                    ToolDiameterMm:           tool.DiameterMm,
                    MaxDepthOfCutMm:          tool.MaxDepthOfCutMm,
                    FeedRateMmPerMin:         tool.RecommendedFeedMmPerMin,
                    SpindleRpm:               tool.RecommendedRpm,
                    MachineOffset:            machine.CncOffset,
                    SafeClearanceHeightMm:    machine.SafeClearanceHeightMm), ct);

                if (!toolpathResult.IsEmpty)
                    cncByLayer[layer] = toolpathResult.GCode;
            }

            var outputPath = Path.Combine(
                _storage.Root, "jobs", job.Id.ToString(), "hybrid.gcode");

            var planResult = await _orchestrator.BuildPlanAsync(new HybridPlanRequest(
                JobId:                 job.Id,
                PrintGCodePath:        job.PrintGCodePath,
                CncGCodeByLayer:       cncByLayer,
                MachineEveryNLayers:   cmd.MachineEveryNLayers,
                TotalPrintLayers:      job.TotalPrintLayers.Value,
                CncToolId:             job.CncToolId.Value,
                EnabledCustomBlocks:   enabledBlocks,
                OutputGCodePath:       outputPath), ct);

            job.MarkReady(planResult.HybridGCodePath);
            await _jobs.UpdateAsync(job, ct);

            _logger.LogInformation("Hybrid plan complete: {Steps} steps → {Path}",
                planResult.Plan.Steps.Count, planResult.HybridGCodePath);

            return new PlanHybridProcessResult(
                cmd.JobId,
                planResult.Plan.Id,
                planResult.HybridGCodePath,
                planResult.Plan.Steps.Count);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Hybrid planning failed for job {JobId}", cmd.JobId);
            job.MarkFailed(ex.Message);
            await _jobs.UpdateAsync(job, ct);
            throw;
        }
    }
}
