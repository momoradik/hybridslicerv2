using HybridSlicer.Application.Interfaces.Repositories;
using HybridSlicer.Domain.Entities;
using HybridSlicer.Domain.Enums;
using HybridSlicer.Domain.ValueObjects;
using Microsoft.AspNetCore.Mvc;

namespace HybridSlicer.Api.Controllers;

[ApiController]
[Route("api/machine-profiles")]
public sealed class MachineProfilesController : ControllerBase
{
    private readonly IMachineProfileRepository _repo;

    public MachineProfilesController(IMachineProfileRepository repo) => _repo = repo;

    [HttpGet]
    public async Task<IActionResult> GetAll(CancellationToken ct)
        => Ok(await _repo.GetAllAsync(ct));

    [HttpGet("{id:guid}")]
    public async Task<IActionResult> GetById(Guid id, CancellationToken ct)
    {
        var profile = await _repo.GetByIdAsync(id, ct);
        return profile is null ? NotFound() : Ok(profile);
    }

    [HttpPost]
    public async Task<IActionResult> Create([FromBody] CreateMachineProfileRequest req, CancellationToken ct)
    {
        var profile = MachineProfile.Create(
            req.Name, req.Type,
            req.BedWidthMm, req.BedDepthMm, req.BedHeightMm,
            req.NozzleDiameterMm, req.ExtruderCount);

        if (req.IpAddress is not null)
            profile.SetNetworkEndpoint(req.IpAddress, req.Port);

        await _repo.AddAsync(profile, ct);
        return CreatedAtAction(nameof(GetById), new { id = profile.Id }, profile);
    }

    [HttpPut("{id:guid}")]
    public async Task<IActionResult> Update(Guid id, [FromBody] UpdateMachineProfileRequest req, CancellationToken ct)
    {
        var profile = await _repo.GetByIdAsync(id, ct);
        if (profile is null) return NotFound();

        if (req.CncOffset is not null)
            profile.UpdateCncOffset(new MachineOffset(
                req.CncOffset.X, req.CncOffset.Y, req.CncOffset.Z, req.CncOffset.RotationDeg));

        if (req.SafeClearanceHeightMm.HasValue)
            profile.SetSafeClearanceHeight(req.SafeClearanceHeightMm.Value);

        await _repo.UpdateAsync(profile, ct);
        return Ok(profile);
    }

    [HttpPut("{id:guid}/offsets")]
    public async Task<IActionResult> UpdateOffsets(Guid id, [FromBody] UpdateOffsetsRequest req, CancellationToken ct)
    {
        var profile = await _repo.GetByIdAsync(id, ct);
        if (profile is null) return NotFound();

        profile.UpdateCncOffset(new MachineOffset(req.X, req.Y, req.Z, req.RotationDeg));

        foreach (var to in req.ToolOffsets)
            profile.UpsertToolOffset(new ToolOffset(to.ToolIndex, to.LengthOffsetMm, to.RadiusOffsetMm,
                to.OffsetX, to.OffsetY, to.OffsetZ, to.Description));

        await _repo.UpdateAsync(profile, ct);
        return Ok(profile);
    }

    [HttpDelete("{id:guid}")]
    public async Task<IActionResult> Delete(Guid id, CancellationToken ct)
    {
        var profile = await _repo.GetByIdAsync(id, ct);
        if (profile is null) return NotFound();
        profile.SoftDelete();
        await _repo.UpdateAsync(profile, ct);
        return NoContent();
    }
}

public record CreateMachineProfileRequest(
    string Name,
    MachineType Type,
    double BedWidthMm,
    double BedDepthMm,
    double BedHeightMm,
    double NozzleDiameterMm = 0.4,
    int ExtruderCount = 1,
    string? IpAddress = null,
    int Port = 8080);

public record UpdateMachineProfileRequest(
    OffsetDto? CncOffset = null,
    double? SafeClearanceHeightMm = null);

public record UpdateOffsetsRequest(
    double X, double Y, double Z, double RotationDeg,
    IReadOnlyList<ToolOffsetDto> ToolOffsets);

public record OffsetDto(double X, double Y, double Z, double RotationDeg = 0);
public record ToolOffsetDto(int ToolIndex, double LengthOffsetMm, double RadiusOffsetMm,
    double OffsetX = 0, double OffsetY = 0, double OffsetZ = 0, string? Description = null);
