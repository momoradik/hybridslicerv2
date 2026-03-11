using FluentAssertions;
using HybridSlicer.Domain.Entities;
using HybridSlicer.Domain.Enums;
using HybridSlicer.Domain.Exceptions;
using Xunit;

namespace HybridSlicer.Domain.Tests;

public class HybridProcessPlanTests
{
    [Fact]
    public void Create_ValidParams_Succeeds()
    {
        var plan = HybridProcessPlan.Create(Guid.NewGuid(), machineEveryN: 5, totalLayers: 100);
        plan.MachineEveryNLayers.Should().Be(5);
        plan.TotalPrintLayers.Should().Be(100);
        plan.OverallSafetyStatus.Should().Be(SafetyStatus.Unvalidated);
    }

    [Fact]
    public void Create_ZeroFrequency_Throws()
    {
        var act = () => HybridProcessPlan.Create(Guid.NewGuid(), 0, 100);
        act.Should().Throw<DomainException>().WithMessage("*frequency*");
    }

    [Fact]
    public void IsExecutionAllowed_WhenBlocked_ReturnsFalse()
    {
        var plan = HybridProcessPlan.Create(Guid.NewGuid(), 5, 100);
        plan.SetOverallSafety(SafetyStatus.Blocked);
        plan.IsExecutionAllowed().Should().BeFalse();
    }

    [Fact]
    public void IsExecutionAllowed_WhenClear_ReturnsTrue()
    {
        var plan = HybridProcessPlan.Create(Guid.NewGuid(), 5, 100);
        plan.SetOverallSafety(SafetyStatus.Clear);
        plan.IsExecutionAllowed().Should().BeTrue();
    }

    [Fact]
    public void AddStep_IncreasesStepCount()
    {
        var plan = HybridProcessPlan.Create(Guid.NewGuid(), 5, 20);
        plan.AddStep(ProcessStep.CreatePrintStep(plan.Id, 0, 1, 5, "G1 X0"));
        plan.AddStep(ProcessStep.CreateMachiningStep(plan.Id, 1, 5, "G0 Z10", Guid.NewGuid()));
        plan.Steps.Should().HaveCount(2);
    }
}
