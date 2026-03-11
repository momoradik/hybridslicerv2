using HybridSlicer.Application.Interfaces;
using HybridSlicer.Application.Interfaces.Repositories;
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
    private readonly ILogger<SlicePrintJobHandler> _logger;

    public SlicePrintJobHandler(
        IPrintJobRepository jobs,
        IPrintProfileRepository printProfiles,
        IMachineProfileRepository machines,
        ISlicingEngine slicer,
        ILogger<SlicePrintJobHandler> logger)
    {
        _jobs = jobs;
        _printProfiles = printProfiles;
        _machines = machines;
        _slicer = slicer;
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
                FirstLayerSpeedMmS:    profile.FirstLayerSpeedMmS,
                InfillDensityPct:      profile.InfillDensityPct,
                InfillPattern:         profile.InfillPattern,
                PrintTemperatureDegC:  profile.PrintTemperatureDegC,
                BedTemperatureDegC:    profile.BedTemperatureDegC,
                RetractLengthMm:       profile.RetractLengthMm,
                RetractSpeedMmS:       profile.RetractSpeedMmS,
                SupportEnabled:        profile.SupportEnabled,
                SupportType:           profile.SupportType,
                CoolingEnabled:        profile.CoolingEnabled,
                CoolingFanSpeedPct:    profile.CoolingFanSpeedPct,
                FilamentDiameterMm:    profile.FilamentDiameterMm,
                BedWidthMm:            machine.BedWidthMm,
                BedDepthMm:            machine.BedDepthMm,
                BedHeightMm:           machine.BedHeightMm,
                NozzleDiameterMm:      machine.NozzleDiameterMm);

            var result = await _slicer.SliceAsync(job.StlFilePath, parameters, ct);

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
}
