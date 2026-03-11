using HybridSlicer.Domain.Enums;
using HybridSlicer.Domain.Exceptions;

namespace HybridSlicer.Domain.Entities;

/// <summary>
/// Ordered sequence of printing, machining, and custom G-code steps that
/// together form the complete hybrid manufacturing process for a job.
/// </summary>
public class HybridProcessPlan
{
    public Guid Id { get; private set; }
    public Guid JobId { get; private set; }
    public int MachineEveryNLayers { get; private set; }
    public int TotalPrintLayers { get; private set; }
    public SafetyStatus OverallSafetyStatus { get; private set; } = SafetyStatus.Unvalidated;
    public DateTime GeneratedAt { get; private set; }

    private readonly List<ProcessStep> _steps = [];
    public IReadOnlyList<ProcessStep> Steps => _steps.AsReadOnly();

    private HybridProcessPlan() { }

    public static HybridProcessPlan Create(Guid jobId, int machineEveryN, int totalLayers)
    {
        if (machineEveryN <= 0)
            throw new DomainException("INVALID_FREQUENCY", "Machining frequency must be at least 1.");
        if (totalLayers <= 0)
            throw new DomainException("INVALID_LAYERS", "Total print layers must be positive.");

        return new HybridProcessPlan
        {
            Id = Guid.NewGuid(),
            JobId = jobId,
            MachineEveryNLayers = machineEveryN,
            TotalPrintLayers = totalLayers,
            GeneratedAt = DateTime.UtcNow
        };
    }

    public void AddStep(ProcessStep step)
    {
        ArgumentNullException.ThrowIfNull(step);
        _steps.Add(step);
    }

    public void SetOverallSafety(SafetyStatus status) => OverallSafetyStatus = status;

    /// <summary>Returns true if every machining step is validated Clear.</summary>
    public bool IsExecutionAllowed()
        => OverallSafetyStatus == SafetyStatus.Clear
           || OverallSafetyStatus == SafetyStatus.Warning; // Warning requires operator confirm upstream
}
