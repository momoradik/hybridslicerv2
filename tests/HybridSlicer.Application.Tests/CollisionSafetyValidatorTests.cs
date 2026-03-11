using FluentAssertions;
using HybridSlicer.Application.Interfaces;
using HybridSlicer.Domain.Enums;
using HybridSlicer.Infrastructure.Safety;
using Microsoft.Extensions.Logging.Abstractions;
using Xunit;

namespace HybridSlicer.Application.Tests;

/// <summary>
/// Comprehensive safety validator tests.
/// Every safety branch must be covered — these tests are the guard-rail
/// that prevents regressions in the safety subsystem.
/// </summary>
public class CollisionSafetyValidatorTests
{
    private readonly CollisionSafetyValidator _sut =
        new(NullLogger<CollisionSafetyValidator>.Instance);

    private static SafetyValidationRequest BaseRequest(string gcode) => new(
        CncGCode:              gcode,
        PrintedGeometryBounds: [],
        MachineMaxX:           300,
        MachineMaxY:           300,
        MachineMaxZ:           300,
        SafeClearanceHeightMm: 5.0,
        ToolRadiusMm:          3.0);

    // ── Clear paths ────────────────────────────────────────────────────────────
    [Fact]
    public async Task EmptyGCode_ReturnsClear()
    {
        var result = await _sut.ValidateToolpathAsync(BaseRequest(""));
        result.Status.Should().Be(SafetyStatus.Clear);
        result.Issues.Should().BeEmpty();
    }

    [Fact]
    public async Task ValidContour_WithinEnvelopeAndAboveClearance_ReturnsClear()
    {
        const string gcode = """
            G0 Z10
            G0 X50 Y50
            G1 Z1 F200
            G1 X100 Y100
            G1 X150 Y50
            G0 Z10
            """;
        var result = await _sut.ValidateToolpathAsync(BaseRequest(gcode));
        result.Status.Should().Be(SafetyStatus.Clear);
    }

    [Fact]
    public async Task CommentsOnly_ReturnsClear()
    {
        const string gcode = "; Start machining\n; End machining\n";
        var result = await _sut.ValidateToolpathAsync(BaseRequest(gcode));
        result.Status.Should().Be(SafetyStatus.Clear);
    }

    // ── Envelope violations ────────────────────────────────────────────────────
    [Theory]
    [InlineData("G1 X350 Y100 Z5",  "X=350")]
    [InlineData("G1 X100 Y350 Z5",  "Y=350")]
    [InlineData("G1 X100 Y100 Z305","Z=305")]
    [InlineData("G1 X-10 Y100 Z5",  "X=-10")]
    public async Task MoveOutsideEnvelope_ReturnsBlocked(string gcode, string _)
    {
        var result = await _sut.ValidateToolpathAsync(BaseRequest(gcode));
        result.Status.Should().Be(SafetyStatus.Blocked);
        result.Issues.Should().NotBeEmpty();
    }

    // ── Clearance violations ───────────────────────────────────────────────────
    [Fact]
    public async Task RapidBelowClearanceHeight_ReturnsWarning()
    {
        const string gcode = "G0 Z3"; // safe clearance = 5
        var result = await _sut.ValidateToolpathAsync(BaseRequest(gcode));
        result.Status.Should().Be(SafetyStatus.Warning);
        result.Issues.Should().ContainMatch("*safe clearance*");
    }

    [Fact]
    public async Task FeedMoveAtLowZ_NotAClearanceViolation()
    {
        // G1 (feed) at Z < clearance is normal (cutting), not a rapid-height violation
        const string gcode = "G1 X50 Y50 Z1 F300";
        var result = await _sut.ValidateToolpathAsync(BaseRequest(gcode));
        // Should be Clear as long as no geometry intersections
        result.Status.Should().Be(SafetyStatus.Clear);
    }

    // ── Geometry intersection ──────────────────────────────────────────────────
    [Fact]
    public async Task FeedMoveInsidePrintedGeometry_ReturnsBlocked()
    {
        const string gcode = "G1 X50 Y50 Z10 F300";
        var request = BaseRequest(gcode) with
        {
            PrintedGeometryBounds = [new BoundingBox3D(0, 0, 0, 100, 100, 50)]
        };

        var result = await _sut.ValidateToolpathAsync(request);
        result.Status.Should().Be(SafetyStatus.Blocked);
        result.Issues.Should().ContainMatch("*intersects*");
    }

    [Fact]
    public async Task FeedMoveOutsidePrintedGeometryBounds_ReturnsClear()
    {
        // Point (200, 200, 10) is outside the printed box (0..100, 0..100, 0..50)
        const string gcode = "G1 X200 Y200 Z10 F300";
        var request = BaseRequest(gcode) with
        {
            PrintedGeometryBounds = [new BoundingBox3D(0, 0, 0, 100, 100, 50)]
        };

        var result = await _sut.ValidateToolpathAsync(request);
        result.Status.Should().Be(SafetyStatus.Clear);
    }

    // ── Multiple issues ────────────────────────────────────────────────────────
    [Fact]
    public async Task MultipleViolations_AllReported()
    {
        const string gcode = """
            G1 X350 Y100 Z5
            G1 X100 Y350 Z5
            """;
        var result = await _sut.ValidateToolpathAsync(BaseRequest(gcode));
        result.Issues.Should().HaveCountGreaterThan(1);
        result.Status.Should().Be(SafetyStatus.Blocked);
    }
}
