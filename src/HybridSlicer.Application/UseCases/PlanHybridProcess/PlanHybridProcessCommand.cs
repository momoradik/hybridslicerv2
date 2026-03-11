using MediatR;

namespace HybridSlicer.Application.UseCases.PlanHybridProcess;

public sealed record PlanHybridProcessCommand(
    Guid JobId,
    int MachineEveryNLayers) : IRequest<PlanHybridProcessResult>;

public sealed record PlanHybridProcessResult(
    Guid JobId,
    Guid PlanId,
    string HybridGCodePath,
    int TotalSteps);
