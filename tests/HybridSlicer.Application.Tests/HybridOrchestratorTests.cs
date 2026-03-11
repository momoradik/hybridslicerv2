using FluentAssertions;
using HybridSlicer.Application.Interfaces;
using HybridSlicer.Domain.Entities;
using HybridSlicer.Domain.Enums;
using HybridSlicer.Infrastructure.Orchestration;
using Microsoft.Extensions.Logging.Abstractions;
using Xunit;

namespace HybridSlicer.Application.Tests;

public class HybridOrchestratorTests : IDisposable
{
    private readonly string _tempDir = Path.Combine(Path.GetTempPath(), Guid.NewGuid().ToString());
    private readonly HybridOrchestrator _orchestrator = new(NullLogger<HybridOrchestrator>.Instance);

    public HybridOrchestratorTests() => Directory.CreateDirectory(_tempDir);

    [Fact]
    public async Task BuildPlanAsync_ProducesHybridGCode_WithCncInjectedEveryN()
    {
        // Arrange: 20-layer print G-code with ;LAYER:N markers
        var printGCode = string.Join("\n",
            Enumerable.Range(1, 20).Select(l => $";LAYER:{l}\nG1 X{l} Y{l} Z{l * 0.2}\n"));

        var printPath = Path.Combine(_tempDir, "print.gcode");
        await File.WriteAllTextAsync(printPath, printGCode);

        var outputPath = Path.Combine(_tempDir, "hybrid.gcode");
        var toolId = Guid.NewGuid();
        var jobId = Guid.NewGuid();

        var cncByLayer = new Dictionary<int, string>
        {
            [5]  = "; CNC at layer 5\nG0 Z10\nG1 X50 Y50 Z1\n",
            [10] = "; CNC at layer 10\nG0 Z10\nG1 X50 Y50 Z2\n",
            [15] = "; CNC at layer 15\nG0 Z10\nG1 X50 Y50 Z3\n",
            [20] = "; CNC at layer 20\nG0 Z10\nG1 X50 Y50 Z4\n",
        };

        var blocks = new List<CustomGCodeBlock>
        {
            CustomGCodeBlock.Create("Before Block", "M3 S12000", GCodeTrigger.BeforeMachining),
            CustomGCodeBlock.Create("After Block",  "M5",        GCodeTrigger.AfterMachining),
        };

        var request = new HybridPlanRequest(
            JobId: jobId,
            PrintGCodePath: printPath,
            CncGCodeByLayer: cncByLayer,
            MachineEveryNLayers: 5,
            TotalPrintLayers: 20,
            CncToolId: toolId,
            EnabledCustomBlocks: blocks,
            OutputGCodePath: outputPath);

        // Act
        var result = await _orchestrator.BuildPlanAsync(request);

        // Assert
        result.Should().NotBeNull();
        result.HybridGCodePath.Should().Be(outputPath);
        File.Exists(outputPath).Should().BeTrue();

        var hybridContent = await File.ReadAllTextAsync(outputPath);
        hybridContent.Should().Contain("CNC at layer 5");
        hybridContent.Should().Contain("M3 S12000");
        hybridContent.Should().Contain("M5");

        result.Plan.Steps.Should().NotBeEmpty();
        result.Plan.Steps.Any(s => s.OperationType == OperationType.Machining).Should().BeTrue();
        result.Plan.Steps.Any(s => s.OperationType == OperationType.CustomGCode).Should().BeTrue();
    }

    public void Dispose()
    {
        if (Directory.Exists(_tempDir))
            Directory.Delete(_tempDir, recursive: true);
    }
}
