using MediatR;

namespace HybridSlicer.Application.UseCases.GenerateToolpaths;

public sealed record GenerateToolpathsCommand(
    Guid JobId,
    Guid CncToolId,
    int MachineEveryNLayers) : IRequest<GenerateToolpathsResult>;

public sealed record GenerateToolpathsResult(
    Guid JobId,
    int ToolpathCount,
    IReadOnlyList<int> MachinedAtLayers);
