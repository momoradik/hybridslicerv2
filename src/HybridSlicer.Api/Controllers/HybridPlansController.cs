using HybridSlicer.Infrastructure.Persistence;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace HybridSlicer.Api.Controllers;

/// <summary>
/// Read-only view of generated hybrid process plans and their ordered steps.
/// Plans are created by POST /api/jobs/{id}/plan-hybrid.
/// </summary>
[ApiController]
[Route("api/hybrid-plans")]
public sealed class HybridPlansController : ControllerBase
{
    private readonly AppDbContext _db;

    public HybridPlansController(AppDbContext db) => _db = db;

    [HttpGet]
    public async Task<IActionResult> GetAll(CancellationToken ct)
        => Ok(await _db.HybridProcessPlans
            .OrderByDescending(p => p.GeneratedAt)
            .ToListAsync(ct));

    [HttpGet("{id:guid}")]
    public async Task<IActionResult> GetById(Guid id, CancellationToken ct)
    {
        var plan = await _db.HybridProcessPlans
            .Include(p => p.Steps.OrderBy(s => s.StepIndex))
            .FirstOrDefaultAsync(p => p.Id == id, ct);

        return plan is null ? NotFound() : Ok(plan);
    }

    [HttpGet("by-job/{jobId:guid}")]
    public async Task<IActionResult> GetByJobId(Guid jobId, CancellationToken ct)
    {
        var plan = await _db.HybridProcessPlans
            .Include(p => p.Steps.OrderBy(s => s.StepIndex))
            .FirstOrDefaultAsync(p => p.JobId == jobId, ct);

        return plan is null ? NotFound() : Ok(plan);
    }
}
