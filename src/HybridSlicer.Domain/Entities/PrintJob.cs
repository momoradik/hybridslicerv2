using HybridSlicer.Domain.Enums;
using HybridSlicer.Domain.Exceptions;

namespace HybridSlicer.Domain.Entities;

/// <summary>
/// Aggregate root representing a single hybrid manufacturing job.
/// All state transitions go through explicit methods to protect invariants.
/// </summary>
public class PrintJob
{
    public Guid Id { get; private set; }
    public string Name { get; private set; } = string.Empty;
    public string StlFilePath { get; private set; } = string.Empty;
    public JobStatus Status { get; private set; }

    // Profile foreign keys
    public Guid MachineProfileId { get; private set; }
    public Guid PrintProfileId { get; private set; }
    public Guid MaterialId { get; private set; }
    public Guid? CncToolId { get; private set; }

    // Per-job overrides
    public bool SupportEnabled { get; private set; }
    public string SupportType { get; private set; } = "normal";
    public string InfillPattern { get; private set; } = "grid";

    // Generated artefact paths (relative to job storage root)
    public string? PrintGCodePath { get; private set; }
    public string? HybridGCodePath { get; private set; }

    // Slicing metadata
    public int? TotalPrintLayers { get; private set; }

    // Error information
    public string? ErrorMessage { get; private set; }

    // Audit
    public DateTime CreatedAt { get; private set; }
    public DateTime UpdatedAt { get; private set; }

    private PrintJob() { }

    public static PrintJob Create(
        string name,
        string stlFilePath,
        Guid machineProfileId,
        Guid printProfileId,
        Guid materialId,
        bool supportEnabled = false,
        string supportType = "normal",
        string infillPattern = "grid")
    {
        if (string.IsNullOrWhiteSpace(name))
            throw new DomainException("INVALID_NAME", "Job name must not be empty.");
        if (string.IsNullOrWhiteSpace(stlFilePath))
            throw new DomainException("INVALID_PATH", "STL file path must not be empty.");

        return new PrintJob
        {
            Id = Guid.NewGuid(),
            Name = name.Trim(),
            StlFilePath = stlFilePath,
            Status = JobStatus.StlImported,
            MachineProfileId = machineProfileId,
            PrintProfileId = printProfileId,
            MaterialId = materialId,
            SupportEnabled = supportEnabled,
            SupportType = string.IsNullOrWhiteSpace(supportType) ? "normal" : supportType,
            InfillPattern = string.IsNullOrWhiteSpace(infillPattern) ? "grid" : infillPattern,
            CreatedAt = DateTime.UtcNow,
            UpdatedAt = DateTime.UtcNow
        };
    }

    public void AssignCncTool(Guid toolId)
    {
        CncToolId = toolId;
        Touch();
    }

    public void MarkSlicing()
    {
        AssertStatus(JobStatus.StlImported, JobStatus.SlicingComplete);
        Status = JobStatus.Slicing;
        Touch();
    }

    public void MarkSlicingComplete(string gcodePath, int totalLayers)
    {
        PrintGCodePath = gcodePath;
        TotalPrintLayers = totalLayers;
        Status = JobStatus.SlicingComplete;
        Touch();
    }

    public void MarkGeneratingToolpaths()
    {
        AssertStatus(JobStatus.SlicingComplete);
        Status = JobStatus.GeneratingToolpaths;
        Touch();
    }

    public void MarkToolpathsComplete()
    {
        AssertStatus(JobStatus.GeneratingToolpaths);
        Status = JobStatus.ToolpathsComplete;
        Touch();
    }

    public void MarkPlanningHybrid()
    {
        AssertStatus(JobStatus.ToolpathsComplete);
        Status = JobStatus.PlanningHybrid;
        Touch();
    }

    public void MarkReady(string hybridGCodePath)
    {
        AssertStatus(JobStatus.PlanningHybrid);
        HybridGCodePath = hybridGCodePath;
        Status = JobStatus.Ready;
        Touch();
    }

    public void MarkFailed(string error)
    {
        ErrorMessage = error;
        Status = JobStatus.Failed;
        Touch();
    }

    private void AssertStatus(params JobStatus[] allowed)
    {
        if (!allowed.Contains(Status))
            throw new DomainException("INVALID_STATE_TRANSITION",
                $"Cannot transition from {Status}. Allowed from: {string.Join(", ", allowed)}.");
    }

    private void Touch() => UpdatedAt = DateTime.UtcNow;
}
