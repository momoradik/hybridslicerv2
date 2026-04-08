using HybridSlicer.Application.Interfaces;
using MediatR;

namespace HybridSlicer.Application.UseCases.GenerateToolpaths;

public sealed record GenerateToolpathsCommand(
    Guid JobId,
    Guid CncToolId,
    int  MachineEveryNLayers,
    /// <summary>When true, also machine inner-wall surfaces (holes, pockets).</summary>
    bool MachineInnerWalls = false,
    /// <summary>
    /// When true, support regions are treated as no-cut zones.
    /// The toolpath is clipped to avoid them rather than skipping the whole layer.
    /// </summary>
    bool   AvoidSupports      = false,
    /// <summary>XY clearance (mm) kept between the tool and any support geometry.</summary>
    double SupportClearanceMm = 2.0,
    /// <summary>
    /// When true, machining layers are computed automatically based on tool flute length
    /// so that lower geometry never becomes unreachable. MachineEveryNLayers is ignored.
    /// Rule: machine when pendingPrintHeight >= tool.FluteLengthMm * 0.8.
    /// </summary>
    bool AutoMachiningFrequency = false) : IRequest<GenerateToolpathsResult>;

public sealed record GenerateToolpathsResult(
    Guid                 JobId,
    int                  ToolpathCount,
    IReadOnlyList<int>   MachinedAtLayers,
    IReadOnlyList<UnmachinableRegion> UnmachinableRegions);
