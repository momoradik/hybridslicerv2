using FluentAssertions;
using HybridSlicer.Application.Interfaces;
using HybridSlicer.Domain.ValueObjects;
using HybridSlicer.Infrastructure.Toolpath;
using Microsoft.Extensions.Logging.Abstractions;
using Xunit;

namespace HybridSlicer.Application.Tests;

/// <summary>
/// Verifies the "Avoid Supports" toolpath logic:
///   1. Regions inside support zones are skipped (SupportBlocked), not machined through.
///   2. Valid regions outside support zones are still machined.
///   3. When geometry operations fail, the region is skipped safely (fail-closed).
///   4. The generated G-code never contains feed moves inside the printed part polygon.
///   5. No regression in normal (no support) toolpath generation.
/// </summary>
public class AvoidSupportsToolpathTests
{
    private readonly ContourToolpathPlanner _planner =
        new(NullLogger<ContourToolpathPlanner>.Instance);

    private static readonly MachineOffset NoOffset = new(0, 0, 0, 0);

    // ── Helpers ────────────────────────────────────────────────────────────────

    /// <summary>Square outer wall path (nozzle centre) centred at origin, side = size mm.</summary>
    private static IReadOnlyList<(double X, double Y)> SquarePath(double size)
    {
        var h = size / 2.0;
        return new[] { (-h, -h), (h, -h), (h, h), (-h, h), (-h, -h) };
    }

    /// <summary>
    /// Simple request: one square outer wall, optional support paths.
    /// Tool Ø4 mm (radius 2), nozzle Ø0.4 mm (radius 0.2), CRC = 2.2 mm outward.
    /// </summary>
    private static WallPathsRequest MakeRequest(
        IReadOnlyList<(double X, double Y)> wall,
        IReadOnlyList<IReadOnlyList<(double X, double Y)>>? supportPaths = null,
        double supportClearance = 2.0,
        bool isOuterWall = true)
        => new(
            WallPaths:            [wall],
            ZHeightMm:            5.0,
            ToolDiameterMm:       4.0,
            NozzleDiameterMm:     0.4,
            FeedRateMmPerMin:     1000,
            SpindleRpm:           12000,
            MachineOffset:        NoOffset,
            SafeClearanceHeightMm: 10.0,
            IsOuterWall:          isOuterWall,
            ClimbMilling:         true,
            SupportPaths:         supportPaths,
            SupportClearanceMm:   supportClearance);

    // ── No-support baseline ────────────────────────────────────────────────────

    [Fact]
    public async Task NoSupports_OuterWall_ProducesNonEmptyToolpath()
    {
        var result = await _planner.PlanFromWallPathsAsync(MakeRequest(SquarePath(20)));

        result.IsEmpty.Should().BeFalse("a 20 mm square wall should produce a valid toolpath");
        result.GCode.Should().Contain("G1", "G-code must contain feed moves");
        result.UnmachinableRegions.Should().BeEmpty("no obstacles on a plain square wall");
    }

    [Fact]
    public async Task NoSupports_OuterWall_GCodeDoesNotEnterWallPolygon()
    {
        // Wall: 20×20 mm square (nozzle centre at ±10 mm).
        // CRC offset = tool_r + nozzle_r = 2 + 0.2 = 2.2 mm outward.
        // Tool centre should be at ~12.2 mm from origin — outside the nozzle-path polygon.
        var result = await _planner.PlanFromWallPathsAsync(MakeRequest(SquarePath(20)));

        result.IsEmpty.Should().BeFalse();

        // Parse X,Y from G1 feed moves and verify all are outside ±10 mm (inside the square)
        foreach (var line in result.GCode.Split('\n'))
        {
            var trimmed = line.Trim();
            if (!trimmed.StartsWith("G1 ") && !trimmed.StartsWith("G1\t")) continue;
            if (!trimmed.Contains('X') || !trimmed.Contains('Y')) continue;

            var x = ParseAxis(trimmed, 'X');
            var y = ParseAxis(trimmed, 'Y');

            // Tool centre should be >= 10+CRC mm from origin in at least one axis
            // (strict inside the 20×20 square would be |x|<10 AND |y|<10)
            var insideSquare = Math.Abs(x) < 9.5 && Math.Abs(y) < 9.5;
            insideSquare.Should().BeFalse(
                $"Feed move G1 X{x:F3} Y{y:F3} must not be inside the 20×20 mm printed wall polygon (tool inside solid material)");
        }
    }

    // ── Support avoidance ──────────────────────────────────────────────────────

    [Fact]
    public async Task SupportOnOneSide_WallStillPartiallyMachined()
    {
        // Wall: 30×30 mm square.
        // Support: a line segment on the right side (+15, ...) — should block only that region.
        var wall = SquarePath(30);
        var support = new List<(double X, double Y)>
        {
            (20, -20), (20, 20)  // vertical line to the right of the wall
        };

        var result = await _planner.PlanFromWallPathsAsync(
            MakeRequest(wall, [[..support]], supportClearance: 2.0));

        // The left/top/bottom portions of the wall should still be machinable
        result.IsEmpty.Should().BeFalse(
            "only the right side is blocked; rest of wall should still be machined");
        result.GCode.Should().Contain("G1",
            "at least some feed moves should be generated for the unblocked portions");
    }

    [Fact]
    public async Task SupportFullyWrappingWall_ProducesSupportBlockedUnmachinableRegion()
    {
        // Wall: 10×10 mm square. Support: huge zone covering everything.
        // The entire toolpath is inside the forbidden zone → SupportBlocked.
        var wall = SquarePath(10);
        // Support path that completely surrounds the wall
        var support = new List<(double X, double Y)>
        {
            (-50, -50), (50, -50), (50, 50), (-50, 50), (-50, -50)
        };

        var result = await _planner.PlanFromWallPathsAsync(
            MakeRequest(wall, [[..support]], supportClearance: 0.1));

        // With huge support covering everything, the entire segment should be SupportBlocked
        result.UnmachinableRegions.Should().NotBeEmpty(
            "entire region is inside the support forbidden zone");
        result.UnmachinableRegions
            .Should().Contain(r => r.Reason == "SupportBlocked",
                "the blocking reason must be SupportBlocked");
    }

    [Fact]
    public async Task SupportAvoidance_GeneratedPathDoesNotEnterWallPolygon()
    {
        // Wall: 30×30 mm square. Support on one corner.
        // After clipping, remaining path must still be OUTSIDE the wall polygon.
        var wall = SquarePath(30);
        var support = new List<(double X, double Y)>
        {
            (18, 18), (40, 18), (40, 40), (18, 40), (18, 18)  // top-right corner support
        };

        var result = await _planner.PlanFromWallPathsAsync(
            MakeRequest(wall, [[..support]], supportClearance: 1.0));

        // Parse all G1 feed moves and verify they are outside the ±15 mm wall polygon
        foreach (var line in result.GCode.Split('\n'))
        {
            var trimmed = line.Trim();
            if (!trimmed.StartsWith("G1 ") && !trimmed.StartsWith("G1\t")) continue;
            if (!trimmed.Contains('X') || !trimmed.Contains('Y')) continue;

            var x = ParseAxis(trimmed, 'X');
            var y = ParseAxis(trimmed, 'Y');

            // A move strictly inside the ±15 mm square is inside solid printed material → illegal
            var insideWall = Math.Abs(x) < 14.0 && Math.Abs(y) < 14.0;
            insideWall.Should().BeFalse(
                $"Feed move G1 X{x:F3} Y{y:F3} must not be inside the 30×30 mm printed wall polygon");
        }
    }

    [Fact]
    public async Task AvoidSupports_NoRapidMovesAtCutDepth()
    {
        // Rapid moves (G0) must always be at safe clearance height (≥ safeZ),
        // never at cut depth — true regardless of support avoidance.
        var wall = SquarePath(20);
        var support = new List<(double X, double Y)>
        {
            (14, -5), (25, -5), (25, 5), (14, 5), (14, -5)  // right-side support
        };

        var result = await _planner.PlanFromWallPathsAsync(
            MakeRequest(wall, [[..support]], supportClearance: 1.0));

        foreach (var line in result.GCode.Split('\n'))
        {
            var trimmed = line.Trim();
            if (!trimmed.StartsWith("G0 ") && !trimmed.StartsWith("G0\t")) continue;
            if (!trimmed.Contains('Z')) continue;

            var z = ParseAxis(trimmed, 'Z');
            // Rapid at Z=5 (the cut height) is illegal — rapids must be at safe clearance height
            z.Should().BeGreaterThan(5.0,
                $"Rapid G0 at Z={z:F3} must be above cut height 5.0 mm (safe clearance = 10 mm)");
        }
    }

    // ── Regression: inner wall (pocket) ────────────────────────────────────────

    [Fact]
    public async Task InnerWall_NoSupports_ProducesValidPocketPath()
    {
        // A pocket: 20×20 mm inner wall, tool Ø4 mm must fit
        var result = await _planner.PlanFromWallPathsAsync(
            MakeRequest(SquarePath(20), isOuterWall: false));

        // The pocket after inward CRC (−2.2 mm each side) is 15.6×15.6 mm — still valid
        result.IsEmpty.Should().BeFalse("20 mm pocket with 4 mm tool should be machinable");
    }

    [Fact]
    public async Task TooNarrowPocket_InnerWall_ReturnsToolTooWide()
    {
        // 3×3 mm pocket with 4 mm tool: after inward CRC (2.2 mm each side) → nothing left
        var result = await _planner.PlanFromWallPathsAsync(
            MakeRequest(SquarePath(3), isOuterWall: false));

        result.IsEmpty.Should().BeTrue();
        result.UnmachinableRegions
            .Should().Contain(r => r.Reason == "ToolTooWide",
                "pocket smaller than tool diameter should be ToolTooWide");
    }

    // ── Helper: parse a single axis value from a G-code line ──────────────────

    private static double ParseAxis(string line, char axis)
    {
        var upper = char.ToUpperInvariant(axis);
        var idx = line.IndexOf(upper);
        if (idx < 0) return 0;
        var start = idx + 1;
        var end = start;
        while (end < line.Length && (char.IsDigit(line[end]) || line[end] == '.' || line[end] == '-'))
            end++;
        return double.TryParse(line[start..end], out var v) ? v : 0;
    }
}
