using FluentAssertions;
using HybridSlicer.Domain.Entities;
using HybridSlicer.Domain.Enums;
using HybridSlicer.Domain.Exceptions;
using Xunit;

namespace HybridSlicer.Domain.Tests;

public class PrintJobTests
{
    private static PrintJob MakeJob() =>
        PrintJob.Create("Test Job", "/tmp/test.stl", Guid.NewGuid(), Guid.NewGuid(), Guid.NewGuid());

    [Fact]
    public void Create_ValidParams_SetsStlImportedStatus()
    {
        var job = MakeJob();
        job.Status.Should().Be(JobStatus.StlImported);
    }

    [Fact]
    public void Create_EmptyName_ThrowsDomainException()
    {
        var act = () => PrintJob.Create("", "/tmp/test.stl", Guid.NewGuid(), Guid.NewGuid(), Guid.NewGuid());
        act.Should().Throw<DomainException>().WithMessage("*name*");
    }

    [Fact]
    public void MarkSlicing_FromStlImported_Succeeds()
    {
        var job = MakeJob();
        job.MarkSlicing();
        job.Status.Should().Be(JobStatus.Slicing);
    }

    [Fact]
    public void MarkSlicingComplete_SetsGCodePathAndLayers()
    {
        var job = MakeJob();
        job.MarkSlicing();
        job.MarkSlicingComplete("/output/print.gcode", 150);

        job.Status.Should().Be(JobStatus.SlicingComplete);
        job.PrintGCodePath.Should().Be("/output/print.gcode");
        job.TotalPrintLayers.Should().Be(150);
    }

    [Fact]
    public void MarkToolpathsComplete_WithoutSlicing_ThrowsInvalidState()
    {
        var job = MakeJob();
        var act = job.MarkGeneratingToolpaths;
        act.Should().Throw<DomainException>().WithMessage("*Cannot transition*");
    }

    [Fact]
    public void FullHappyPath_TransitionsToReady()
    {
        var job = MakeJob();
        job.MarkSlicing();
        job.MarkSlicingComplete("/print.gcode", 200);
        job.MarkGeneratingToolpaths();
        job.MarkToolpathsComplete();
        job.MarkPlanningHybrid();
        job.MarkReady("/hybrid.gcode");

        job.Status.Should().Be(JobStatus.Ready);
        job.HybridGCodePath.Should().Be("/hybrid.gcode");
    }
}
