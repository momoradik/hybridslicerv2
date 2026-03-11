using HybridSlicer.Application.Interfaces.Repositories;
using HybridSlicer.Domain.Entities;
using HybridSlicer.Domain.Enums;
using Microsoft.EntityFrameworkCore;

namespace HybridSlicer.Infrastructure.Persistence.Repositories;

public sealed class PrintJobRepository : IPrintJobRepository
{
    private readonly AppDbContext _db;

    public PrintJobRepository(AppDbContext db) => _db = db;

    public async Task<PrintJob?> GetByIdAsync(Guid id, CancellationToken ct = default)
        => await _db.PrintJobs.FirstOrDefaultAsync(x => x.Id == id, ct);

    public async Task<IReadOnlyList<PrintJob>> GetAllAsync(CancellationToken ct = default)
        => await _db.PrintJobs.OrderByDescending(x => x.CreatedAt).ToListAsync(ct);

    public async Task<IReadOnlyList<PrintJob>> GetByStatusAsync(JobStatus status, CancellationToken ct = default)
        => await _db.PrintJobs.Where(x => x.Status == status).ToListAsync(ct);

    public async Task AddAsync(PrintJob job, CancellationToken ct = default)
    {
        await _db.PrintJobs.AddAsync(job, ct);
        await _db.SaveChangesAsync(ct);
    }

    public async Task UpdateAsync(PrintJob job, CancellationToken ct = default)
    {
        _db.PrintJobs.Update(job);
        await _db.SaveChangesAsync(ct);
    }
}
