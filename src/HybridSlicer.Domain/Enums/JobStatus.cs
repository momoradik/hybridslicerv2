namespace HybridSlicer.Domain.Enums;

public enum JobStatus
{
    Draft = 0,
    StlImported = 1,
    Slicing = 2,
    SlicingComplete = 3,
    GeneratingToolpaths = 4,
    ToolpathsComplete = 5,
    PlanningHybrid = 6,
    Ready = 7,
    Running = 8,
    Paused = 9,
    Complete = 10,
    Failed = 99
}
