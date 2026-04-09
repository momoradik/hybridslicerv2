using HybridSlicer.Application.Interfaces.Repositories;
using HybridSlicer.Application.UseCases.GenerateToolpaths;
using HybridSlicer.Application.UseCases.ImportStl;
using HybridSlicer.Application.UseCases.PlanHybridProcess;
using HybridSlicer.Application.UseCases.SlicePrintJob;
using MediatR;
using Microsoft.AspNetCore.Mvc;

namespace HybridSlicer.Api.Controllers;

[ApiController]
[Route("api/jobs")]
public sealed class JobsController : ControllerBase
{
    private readonly IMediator _mediator;
    private readonly IPrintJobRepository _jobs;

    public JobsController(IMediator mediator, IPrintJobRepository jobs)
    {
        _mediator = mediator;
        _jobs = jobs;
    }

    [HttpGet]
    public async Task<IActionResult> GetAll(CancellationToken ct)
        => Ok(await _jobs.GetAllAsync(ct));

    [HttpGet("{id:guid}")]
    public async Task<IActionResult> GetById(Guid id, CancellationToken ct)
    {
        var job = await _jobs.GetByIdAsync(id, ct);
        return job is null ? NotFound() : Ok(job);
    }

    [HttpPost("upload-stl")]
    [RequestSizeLimit(256 * 1024 * 1024)]
    public async Task<IActionResult> UploadStl(
        [FromForm] UploadStlRequest request,
        CancellationToken ct)
    {
        if (request.File.Length == 0) return BadRequest("File is empty.");

        await using var stream = request.File.OpenReadStream();
        var result = await _mediator.Send(new ImportStlCommand(
            JobName: request.JobName,
            StlStream: stream,
            OriginalFileName: request.File.FileName,
            MachineProfileId: request.MachineProfileId,
            PrintProfileId: request.PrintProfileId,
            MaterialId: request.MaterialId,
            SupportEnabled: request.SupportEnabled,
            SupportType: request.SupportType,
            SupportPlacement: request.SupportPlacement,
            InfillPattern: request.InfillPattern,
            InfillDensityPct: request.InfillDensityPct), ct);

        return CreatedAtAction(nameof(GetById), new { id = result.JobId }, result);
    }

    [HttpPost]
    public IActionResult Create([FromBody] CreateJobRequest request, CancellationToken ct)
    {
        // Convenience endpoint: creates a job record before STL upload
        // In full implementation this creates a Draft job and returns ID for upload
        return Accepted(new { message = "Use upload-stl endpoint with multipart form data." });
    }

    [HttpPost("{id:guid}/slice")]
    public async Task<IActionResult> Slice(Guid id, CancellationToken ct)
    {
        var result = await _mediator.Send(new SlicePrintJobCommand(id), ct);
        return Accepted(result);
    }

    [HttpPost("{id:guid}/generate-toolpaths")]
    public async Task<IActionResult> GenerateToolpaths(
        Guid id,
        [FromBody] GenerateToolpathsRequest request,
        CancellationToken ct)
    {
        var result = await _mediator.Send(
            new GenerateToolpathsCommand(
                id,
                request.CncToolId,
                request.MachineEveryNLayers,
                request.MachineInnerWalls,
                request.AvoidSupports,
                request.SupportClearanceMm,
                request.AutoMachiningFrequency,
                request.ZSafetyOffsetMm,
                request.SpindleRpmOverride,
                request.SpindleStartX,
                request.SpindleStartY,
                request.SpindleStartZ,
                request.SpindleEndX,
                request.SpindleEndY,
                request.SpindleEndZ), ct);
        return Accepted(result);
    }

    [HttpPost("{id:guid}/plan-hybrid")]
    public async Task<IActionResult> PlanHybrid(
        Guid id,
        [FromBody] PlanHybridRequest request,
        CancellationToken ct)
    {
        var result = await _mediator.Send(
            new PlanHybridProcessCommand(id, request.MachineEveryNLayers), ct);
        return Accepted(result);
    }

    [HttpGet("{id:guid}/toolpath-gcode")]
    public async Task<IActionResult> GetToolpathGCode(Guid id, CancellationToken ct)
    {
        var job = await _jobs.GetByIdAsync(id, ct);
        if (job is null) return NotFound();
        if (job.ToolpathGCodePath is null) return BadRequest("Toolpath G-code not yet generated.");
        if (!System.IO.File.Exists(job.ToolpathGCodePath)) return NotFound("Toolpath G-code file not found on disk.");
        var stream = System.IO.File.OpenRead(job.ToolpathGCodePath);
        return File(stream, "text/plain");
    }

    [HttpGet("{id:guid}/print-gcode")]
    public async Task<IActionResult> GetPrintGCode(Guid id, CancellationToken ct)
    {
        var job = await _jobs.GetByIdAsync(id, ct);
        if (job is null) return NotFound();
        if (job.PrintGCodePath is null) return BadRequest("Print G-code not yet generated.");
        if (!System.IO.File.Exists(job.PrintGCodePath)) return NotFound("G-code file not found on disk.");
        var stream = System.IO.File.OpenRead(job.PrintGCodePath);
        return File(stream, "text/plain");
    }

    [HttpGet("{id:guid}/gcode")]
    public async Task<IActionResult> DownloadGCode(Guid id, CancellationToken ct)
    {
        var job = await _jobs.GetByIdAsync(id, ct);
        if (job is null) return NotFound();
        if (job.HybridGCodePath is null) return BadRequest("Hybrid G-code not yet generated.");
        if (!System.IO.File.Exists(job.HybridGCodePath)) return NotFound("G-code file not found on disk.");

        var stream = System.IO.File.OpenRead(job.HybridGCodePath);
        return File(stream, "text/plain", $"hybrid_{id}.gcode");
    }

    [HttpDelete("{id:guid}")]
    public async Task<IActionResult> Delete(Guid id, CancellationToken ct)
    {
        var job = await _jobs.GetByIdAsync(id, ct);
        if (job is null) return NotFound();

        // Delete all files in the job directory (STL + all generated G-code)
        var jobDir = Path.GetDirectoryName(job.StlFilePath);
        if (jobDir is not null && Directory.Exists(jobDir))
        {
            try { Directory.Delete(jobDir, recursive: true); }
            catch { /* best-effort */ }
        }

        await _jobs.DeleteAsync(id, ct);
        return NoContent();
    }
}

public record UploadStlRequest(
    [FromForm] IFormFile File,
    [FromForm] string JobName,
    [FromForm] Guid MachineProfileId,
    [FromForm] Guid PrintProfileId,
    [FromForm] Guid MaterialId,
    [FromForm] bool SupportEnabled = false,
    [FromForm] string SupportType = "normal",
    [FromForm] string SupportPlacement = "everywhere",
    [FromForm] string InfillPattern = "grid",
    [FromForm] double? InfillDensityPct = 15);

public record CreateJobRequest(string JobName, Guid MachineProfileId, Guid PrintProfileId, Guid MaterialId);
public record GenerateToolpathsRequest(
    Guid   CncToolId,
    int    MachineEveryNLayers,
    bool   MachineInnerWalls        = false,
    bool   AvoidSupports            = false,
    double SupportClearanceMm       = 2.0,
    bool   AutoMachiningFrequency   = false,
    double ZSafetyOffsetMm          = 0.0,
    int?   SpindleRpmOverride       = null,
    double SpindleStartX            = 0.0,
    double SpindleStartY            = 0.0,
    double? SpindleStartZ           = null,
    double SpindleEndX              = 0.0,
    double SpindleEndY              = 0.0,
    double? SpindleEndZ             = null);
public record PlanHybridRequest(int MachineEveryNLayers);
