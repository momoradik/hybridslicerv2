using HybridSlicer.Infrastructure.Persistence;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace HybridSlicer.Api.Controllers;

[ApiController]
[Route("api/branding")]
public sealed class BrandingController : ControllerBase
{
    private readonly AppDbContext _db;

    public BrandingController(AppDbContext db) => _db = db;

    [HttpGet]
    public async Task<IActionResult> Get(CancellationToken ct)
    {
        var settings = await _db.BrandingSettings.FirstOrDefaultAsync(ct);
        if (settings is null) return Ok(new { CompanyName = "HybridSlicer", AppTitle = "HybridSlicer", PrimaryColor = "#2563EB", AccentColor = "#7C3AED" });
        return Ok(settings);
    }

    [HttpPut]
    public async Task<IActionResult> Update([FromBody] UpdateBrandingRequest req, CancellationToken ct)
    {
        var settings = await _db.BrandingSettings.FirstOrDefaultAsync(ct);
        if (settings is null)
        {
            settings = HybridSlicer.Domain.Entities.BrandingSettings.Default();
            _db.BrandingSettings.Add(settings);
        }

        settings.Update(req.CompanyName, req.AppTitle, req.PrimaryColor, req.AccentColor,
            req.LogoUrl, req.SupportEmail, req.SupportUrl);

        await _db.SaveChangesAsync(ct);
        return Ok(settings);
    }
}

public record UpdateBrandingRequest(
    string CompanyName,
    string AppTitle,
    string PrimaryColor,
    string AccentColor,
    string? LogoUrl = null,
    string? SupportEmail = null,
    string? SupportUrl = null);
