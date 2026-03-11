using HybridSlicer.Application.Interfaces.Repositories;
using HybridSlicer.Domain.Entities;
using Microsoft.EntityFrameworkCore;

namespace HybridSlicer.Infrastructure.Persistence.Repositories;

public sealed class PrintProfileRepository : IPrintProfileRepository
{
    private readonly AppDbContext _db;

    public PrintProfileRepository(AppDbContext db) => _db = db;

    public Task<PrintProfile?> GetByIdAsync(Guid id, CancellationToken ct = default)
        => _db.PrintProfiles.FirstOrDefaultAsync(x => x.Id == id, ct);

    public async Task<IReadOnlyList<PrintProfile>> GetAllAsync(CancellationToken ct = default)
        => await _db.PrintProfiles.OrderBy(x => x.Name).ToListAsync(ct);

    public async Task AddAsync(PrintProfile profile, CancellationToken ct = default)
    {
        await _db.PrintProfiles.AddAsync(profile, ct);
        await _db.SaveChangesAsync(ct);
    }

    public async Task UpdateAsync(PrintProfile profile, CancellationToken ct = default)
    {
        _db.PrintProfiles.Update(profile);
        await _db.SaveChangesAsync(ct);
    }
}
