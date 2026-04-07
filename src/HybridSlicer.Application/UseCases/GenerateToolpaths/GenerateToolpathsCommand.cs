using MediatR;

namespace HybridSlicer.Application.UseCases.GenerateToolpaths;

public sealed record GenerateToolpathsCommand(
    Guid JobId,
    Guid CncToolId,
    int  MachineEveryNLayers,
    /// <summary>When true, also machine inner-wall surfaces (holes, pockets).</summary>
    bool MachineInnerWalls = false,
    /// <summary>When true, skip CNC at layers where Cura generated support structures.</summary>
    bool AvoidSupports = false) : IRequest<GenerateToolpathsResult>;

public sealed record GenerateToolpathsResult(
    Guid                 JobId,
    int                  ToolpathCount,
    IReadOnlyList<int>   MachinedAtLayers);
