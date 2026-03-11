using FluentAssertions;
using HybridSlicer.Domain.Entities;
using HybridSlicer.Domain.Enums;
using HybridSlicer.Domain.Exceptions;
using Xunit;

namespace HybridSlicer.Domain.Tests;

public class CncToolTests
{
    [Fact]
    public void Create_ValidParams_RadiusIsHalfDiameter()
    {
        var tool = CncTool.Create("Test Tool", ToolType.FlatEndMill, 6.0, 25.0, 6.0);
        tool.RadiusMm.Should().Be(3.0);
    }

    [Fact]
    public void Create_ZeroDiameter_Throws()
    {
        var act = () => CncTool.Create("Bad Tool", ToolType.FlatEndMill, 0, 25, 6);
        act.Should().Throw<DomainException>().WithMessage("*diameter*");
    }

    [Fact]
    public void Create_EmptyName_Throws()
    {
        var act = () => CncTool.Create("", ToolType.FlatEndMill, 6, 25, 6);
        act.Should().Throw<DomainException>().WithMessage("*name*");
    }

    [Fact]
    public void UpdateCuttingParameters_ValidValues_Updates()
    {
        var tool = CncTool.Create("Tool", ToolType.FlatEndMill, 6, 25, 6);
        tool.UpdateCuttingParameters(12000, 900, 1.5);

        tool.RecommendedRpm.Should().Be(12000);
        tool.RecommendedFeedMmPerMin.Should().Be(900);
        tool.MaxDepthOfCutMm.Should().Be(1.5);
    }

    [Fact]
    public void UpdateCuttingParameters_ZeroRpm_Throws()
    {
        var tool = CncTool.Create("Tool", ToolType.FlatEndMill, 6, 25, 6);
        var act = () => tool.UpdateCuttingParameters(0, 500, 1.0);
        act.Should().Throw<DomainException>();
    }

    [Fact]
    public void DefaultMaxDepthOfCut_Is25PercentOfDiameter()
    {
        var tool = CncTool.Create("Tool", ToolType.FlatEndMill, 8, 30, 8);
        tool.MaxDepthOfCutMm.Should().Be(2.0); // 8 * 0.25
    }
}
