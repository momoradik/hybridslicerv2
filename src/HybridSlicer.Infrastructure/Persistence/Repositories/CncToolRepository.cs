using HybridSlicer.Application.Interfaces.Repositories;
using HybridSlicer.Domain.Entities;
using Microsoft.EntityFrameworkCore;

namespace HybridSlicer.Infrastructure.Persistence.Repositories;

public sealed class CncToolRepository : ICncToolRepository
{
    private readonly AppDbContext _db;

    public CncToolRepository(AppDbContext db) => _db = db;

    public Task<CncTool?> GetByIdAsync(Guid id, CancellationToken ct = default)
        => _db.CncTools.FirstOrDefaultAsync(x => x.Id == id, ct);

    public async Task<IReadOnlyList<CncTool>> GetAllAsync(CancellationToken ct = default)
        => await _db.CncTools.OrderBy(x => x.Name).ToListAsync(ct);

    public async Task AddAsync(CncTool tool, CancellationToken ct = default)
    {
        await _db.CncTools.AddAsync(tool, ct);
        await _db.SaveChangesAsync(ct);
    }

    public async Task UpdateAsync(CncTool tool, CancellationToken ct = default)
    {
        _db.CncTools.Update(tool);
        await _db.SaveChangesAsync(ct);
    }
}
