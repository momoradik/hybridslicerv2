using FluentAssertions;
using HybridSlicer.Domain.Entities;
using HybridSlicer.Domain.Enums;
using HybridSlicer.Domain.Exceptions;
using HybridSlicer.Domain.ValueObjects;
using Xunit;

namespace HybridSlicer.Domain.Tests;

public class MachineProfileTests
{
    private static MachineProfile MakeProfile() =>
        MachineProfile.Create("Test Machine", MachineType.Hybrid, 300, 300, 350);

    [Fact]
    public void Create_ValidParams_Succeeds()
    {
        var p = MakeProfile();
        p.Name.Should().Be("Test Machine");
        p.Type.Should().Be(MachineType.Hybrid);
        p.BedWidthMm.Should().Be(300);
    }

    [Fact]
    public void Create_EmptyName_Throws()
    {
        var act = () => MachineProfile.Create("", MachineType.FDM, 200, 200, 200);
        act.Should().Throw<DomainException>();
    }

    [Fact]
    public void Create_ZeroBedDimension_Throws()
    {
        var act = () => MachineProfile.Create("X", MachineType.FDM, 0, 200, 200);
        act.Should().Throw<DomainException>().WithMessage("*dimension*");
    }

    [Fact]
    public void SetNetworkEndpoint_ValidValues_Succeeds()
    {
        var p = MakeProfile();
        p.SetNetworkEndpoint("192.168.1.10", 8080);
        p.IpAddress.Should().Be("192.168.1.10");
        p.Port.Should().Be(8080);
    }

    [Fact]
    public void SetNetworkEndpoint_InvalidPort_Throws()
    {
        var p = MakeProfile();
        var act = () => p.SetNetworkEndpoint("192.168.1.1", 70000);
        act.Should().Throw<DomainException>().WithMessage("*Port*");
    }

    [Fact]
    public void UpdateCncOffset_ChangesOffset()
    {
        var p = MakeProfile();
        var offset = new MachineOffset(10, 5, 0, 0);
        p.UpdateCncOffset(offset);
        p.CncOffset.X.Should().Be(10);
        p.CncOffset.Y.Should().Be(5);
    }

    [Fact]
    public void UpsertToolOffset_NewIndex_Adds()
    {
        var p = MakeProfile();
        p.UpsertToolOffset(new ToolOffset(1, 5.0, 0.1));
        p.ToolOffsets.Should().HaveCount(1);
    }

    [Fact]
    public void UpsertToolOffset_SameIndex_Replaces()
    {
        var p = MakeProfile();
        p.UpsertToolOffset(new ToolOffset(1, 5.0, 0.1));
        p.UpsertToolOffset(new ToolOffset(1, 7.0, 0.2));
        p.ToolOffsets.Should().HaveCount(1);
        p.ToolOffsets[0].LengthOffsetMm.Should().Be(7.0);
    }

    [Fact]
    public void SoftDelete_SetsIsDeleted()
    {
        var p = MakeProfile();
        p.SoftDelete();
        p.IsDeleted.Should().BeTrue();
    }
}
