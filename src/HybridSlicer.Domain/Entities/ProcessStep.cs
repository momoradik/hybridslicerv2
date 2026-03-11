using HybridSlicer.Domain.Enums;

namespace HybridSlicer.Domain.Entities;

/// <summary>
/// A single ordered step inside a <see cref="HybridProcessPlan"/>.
/// Exactly one of PrintGCodeFragment, CncGCodeFragment, or CustomGCodeBlockId
/// will be populated, matching the OperationType.
/// </summary>
public class ProcessStep
{
    public Guid Id { get; private set; }
    public Guid PlanId { get; private set; }
    public int StepIndex { get; private set; }
    public OperationType OperationType { get; private set; }

    // For Printing steps
    public int? StartLayer { get; private set; }
    public int? EndLayer { get; private set; }
    public string? PrintGCodeFragment { get; private set; }

    // For Machining steps
    public string? CncGCodeFragment { get; private set; }
    public Guid? ToolId { get; private set; }
    public SafetyStatus SafetyStatus { get; private set; } = SafetyStatus.Unvalidated;
    public string? SafetyNotes { get; private set; }

    // For CustomGCode steps
    public Guid? CustomGCodeBlockId { get; private set; }

    private ProcessStep() { }

    public static ProcessStep CreatePrintStep(Guid planId, int index, int startLayer, int endLayer, string gcode)
        => new()
        {
            Id = Guid.NewGuid(),
            PlanId = planId,
            StepIndex = index,
            OperationType = OperationType.Printing,
            StartLayer = startLayer,
            EndLayer = endLayer,
            PrintGCodeFragment = gcode
        };

    public static ProcessStep CreateMachiningStep(Guid planId, int index, int atLayer, string gcode, Guid toolId)
        => new()
        {
            Id = Guid.NewGuid(),
            PlanId = planId,
            StepIndex = index,
            OperationType = OperationType.Machining,
            StartLayer = atLayer,
            EndLayer = atLayer,
            CncGCodeFragment = gcode,
            ToolId = toolId
        };

    public static ProcessStep CreateCustomGCodeStep(Guid planId, int index, Guid blockId)
        => new()
        {
            Id = Guid.NewGuid(),
            PlanId = planId,
            StepIndex = index,
            OperationType = OperationType.CustomGCode,
            CustomGCodeBlockId = blockId
        };

    public void SetSafetyResult(SafetyStatus status, string? notes = null)
    {
        SafetyStatus = status;
        SafetyNotes = notes;
    }
}
