using MediatR;

namespace HybridSlicer.Application.UseCases.SlicePrintJob;

public sealed record SlicePrintJobCommand(Guid JobId) : IRequest<SlicePrintJobResult>;

public sealed record SlicePrintJobResult(
    Guid JobId,
    string GCodePath,
    int TotalLayers,
    double EstimatedPrintTimeSec,
    double EstimatedFilamentMm);
