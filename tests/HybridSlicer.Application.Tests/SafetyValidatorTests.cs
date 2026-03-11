using FluentAssertions;
using HybridSlicer.Application.Interfaces;
using HybridSlicer.Domain.Enums;
using HybridSlicer.Infrastructure.Safety;
using Microsoft.Extensions.Logging.Abstractions;
using Xunit;

namespace HybridSlicer.Application.Tests;

public class SafetyValidatorTests
{
    private readonly CollisionSafetyValidator _validator =
        new(NullLogger<CollisionSafetyValidator>.Instance);

    private static SafetyValidationRequest MakeRequest(string gcode) => new(
        CncGCode: gcode,
        PrintedGeometryBounds: [],
        MachineMaxX: 300, MachineMaxY: 300, MachineMaxZ: 300,
        SafeClearanceHeightMm: 5,
        ToolRadiusMm: 3);

    [Fact]
    public async Task ValidGCode_WithinLimits_ReturnsClear()
    {
        const string gcode = "G0 Z10\nG0 X100 Y100\nG1 Z2 F500\nG1 X150 Y150";
        var result = await _validator.ValidateToolpathAsync(MakeRequest(gcode));
        result.Status.Should().Be(SafetyStatus.Clear);
        result.Issues.Should().BeEmpty();
    }

    [Fact]
    public async Task RapidBelowSafeClearance_ReturnsWarning()
    {
        const string gcode = "G0 Z3"; // below safe clearance of 5
        var result = await _validator.ValidateToolpathAsync(MakeRequest(gcode));
        result.Status.Should().Be(SafetyStatus.Warning);
        result.Issues.Should().ContainMatch("*safe clearance*");
    }

    [Fact]
    public async Task MoveOutsideEnvelope_ReturnsBlocked()
    {
        const string gcode = "G1 X350 Y100 Z2"; // X=350 > max 300
        var result = await _validator.ValidateToolpathAsync(MakeRequest(gcode));
        result.Status.Should().Be(SafetyStatus.Blocked);
        result.Issues.Should().ContainMatch("*envelope*");
    }

    [Fact]
    public async Task CutMoveInsidePrintedGeometry_ReturnsBlocked()
    {
        const string gcode = "G1 X50 Y50 Z10";
        var request = new SafetyValidationRequest(
            CncGCode: gcode,
            PrintedGeometryBounds:
            [
                new BoundingBox3D(0, 0, 0, 100, 100, 50) // printed box that contains point
            ],
            MachineMaxX: 300, MachineMaxY: 300, MachineMaxZ: 300,
            SafeClearanceHeightMm: 5, ToolRadiusMm: 3);

        var result = await _validator.ValidateToolpathAsync(request);
        result.Status.Should().Be(SafetyStatus.Blocked);
        result.Issues.Should().ContainMatch("*intersects*");
    }
}
