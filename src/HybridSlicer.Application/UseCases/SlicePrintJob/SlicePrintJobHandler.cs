using System.Text;
using HybridSlicer.Application.Interfaces;
using HybridSlicer.Application.Interfaces.Repositories;
using HybridSlicer.Domain.Enums;
using HybridSlicer.Domain.Exceptions;
using MediatR;
using Microsoft.Extensions.Logging;

namespace HybridSlicer.Application.UseCases.SlicePrintJob;

public sealed class SlicePrintJobHandler : IRequestHandler<SlicePrintJobCommand, SlicePrintJobResult>
{
    private readonly IPrintJobRepository _jobs;
    private readonly IPrintProfileRepository _printProfiles;
    private readonly IMachineProfileRepository _machines;
    private readonly ISlicingEngine _slicer;
    private readonly ICustomGCodeBlockRepository _customGCode;
    private readonly ILogger<SlicePrintJobHandler> _logger;

    public SlicePrintJobHandler(
        IPrintJobRepository jobs,
        IPrintProfileRepository printProfiles,
        IMachineProfileRepository machines,
        ISlicingEngine slicer,
        ICustomGCodeBlockRepository customGCode,
        ILogger<SlicePrintJobHandler> logger)
    {
        _jobs = jobs;
        _printProfiles = printProfiles;
        _machines = machines;
        _slicer = slicer;
        _customGCode = customGCode;
        _logger = logger;
    }

    public async Task<SlicePrintJobResult> Handle(SlicePrintJobCommand cmd, CancellationToken ct)
    {
        var job = await _jobs.GetByIdAsync(cmd.JobId, ct)
            ?? throw new DomainException("JOB_NOT_FOUND", $"Job {cmd.JobId} not found.");

        var profile = await _printProfiles.GetByIdAsync(job.PrintProfileId, ct)
            ?? throw new DomainException("PROFILE_NOT_FOUND", $"Print profile {job.PrintProfileId} not found.");

        var machine = await _machines.GetByIdAsync(job.MachineProfileId, ct)
            ?? throw new DomainException("MACHINE_NOT_FOUND", $"Machine profile {job.MachineProfileId} not found.");

        job.MarkSlicing();
        await _jobs.UpdateAsync(job, ct);

        _logger.LogInformation("Slicing job {JobId} with profile '{Profile}'", cmd.JobId, profile.Name);

        try
        {
            var parameters = new SlicingParameters(
                LayerHeightMm:         profile.LayerHeightMm,
                LineWidthMm:           profile.LineWidthMm,
                WallCount:             profile.WallCount,
                TopBottomLayers:       profile.TopBottomLayers,
                PrintSpeedMmS:         profile.PrintSpeedMmS,
                TravelSpeedMmS:        profile.TravelSpeedMmS,
                InfillSpeedMmS:        profile.InfillSpeedMmS,
                WallSpeedMmS:          profile.WallSpeedMmS,
                InnerWallSpeedMmS:     profile.InnerWallSpeedMmS,
                FirstLayerSpeedMmS:    profile.FirstLayerSpeedMmS,
                InfillDensityPct:      job.InfillDensityPct ?? profile.InfillDensityPct,
                InfillPattern:         string.IsNullOrWhiteSpace(job.InfillPattern) ? profile.InfillPattern : job.InfillPattern,
                PrintTemperatureDegC:  profile.PrintTemperatureDegC,
                BedTemperatureDegC:    profile.BedTemperatureDegC,
                RetractLengthMm:       profile.RetractLengthMm,
                RetractSpeedMmS:       profile.RetractSpeedMmS,
                SupportEnabled:        job.SupportEnabled,
                SupportType:           job.SupportType,
                SupportPlacement:      job.SupportPlacement,
                CoolingEnabled:        profile.CoolingEnabled,
                CoolingFanSpeedPct:    profile.CoolingFanSpeedPct,
                FilamentDiameterMm:    profile.PelletModeEnabled
                                           ? profile.VirtualFilamentDiameterMm
                                           : profile.FilamentDiameterMm,
                BedWidthMm:            machine.BedWidthMm,
                BedDepthMm:            machine.BedDepthMm,
                BedHeightMm:           machine.BedHeightMm,
                NozzleDiameterMm:      profile.NozzleDiameterMm > 0 ? profile.NozzleDiameterMm : machine.NozzleDiameterMm,
                MaterialFlowPct:       profile.MaterialFlowPct);

            var result = await _slicer.SliceAsync(job.StlFilePath, parameters, ct);

            await InjectCustomGCodeAsync(result.GCodeFilePath, ct);

            job.MarkSlicingComplete(result.GCodeFilePath, result.TotalLayers);
            await _jobs.UpdateAsync(job, ct);

            _logger.LogInformation("Slice complete for job {JobId}: {Layers} layers", cmd.JobId, result.TotalLayers);

            return new SlicePrintJobResult(
                cmd.JobId,
                result.GCodeFilePath,
                result.TotalLayers,
                result.EstimatedPrintTimeSec,
                result.EstimatedFilamentMm);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Slicing failed for job {JobId}", cmd.JobId);
            job.MarkFailed(ex.Message);
            await _jobs.UpdateAsync(job, ct);
            throw;
        }
    }

    private async Task InjectCustomGCodeAsync(string gcodePath, CancellationToken ct)
    {
        var startBlocks = (await _customGCode.GetByTriggerAsync(GCodeTrigger.JobStart, ct))
            .Where(b => b.IsEnabled).OrderBy(b => b.SortOrder).ToList();
        var endBlocks = (await _customGCode.GetByTriggerAsync(GCodeTrigger.JobEnd, ct))
            .Where(b => b.IsEnabled).OrderBy(b => b.SortOrder).ToList();

        if (startBlocks.Count == 0 && endBlocks.Count == 0) return;

        var original = await File.ReadAllTextAsync(gcodePath, ct);
        var sb = new StringBuilder();

        if (startBlocks.Count > 0)
        {
            sb.AppendLine("; === Custom G-code: Job Start ===");
            foreach (var block in startBlocks)
                sb.AppendLine(block.GCodeContent);
            sb.AppendLine("; === End Custom G-code ===");
            sb.AppendLine();
        }

        sb.Append(original);

        if (endBlocks.Count > 0)
        {
            sb.AppendLine();
            sb.AppendLine("; === Custom G-code: Job End ===");
            foreach (var block in endBlocks)
                sb.AppendLine(block.GCodeContent);
            sb.AppendLine("; === End Custom G-code ===");
        }

        await File.WriteAllTextAsync(gcodePath, sb.ToString(), ct);
    }
}
