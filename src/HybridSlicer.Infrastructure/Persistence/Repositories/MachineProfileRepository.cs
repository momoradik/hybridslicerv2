using HybridSlicer.Application.Interfaces.Repositories;
using HybridSlicer.Domain.Entities;
using Microsoft.EntityFrameworkCore;

namespace HybridSlicer.Infrastructure.Persistence.Repositories;

public sealed class MachineProfileRepository : IMachineProfileRepository
{
    private readonly AppDbContext _db;

    public MachineProfileRepository(AppDbContext db) => _db = db;

    public async Task<MachineProfile?> GetByIdAsync(Guid id, CancellationToken ct = default)
        => await _db.MachineProfiles.FirstOrDefaultAsync(x => x.Id == id, ct);

    public async Task<IReadOnlyList<MachineProfile>> GetAllAsync(CancellationToken ct = default)
        => await _db.MachineProfiles.OrderBy(x => x.Name).ToListAsync(ct);

    public async Task AddAsync(MachineProfile profile, CancellationToken ct = default)
    {
        await _db.MachineProfiles.AddAsync(profile, ct);
        await _db.SaveChangesAsync(ct);
    }

    public async Task UpdateAsync(MachineProfile profile, CancellationToken ct = default)
    {
        _db.MachineProfiles.Update(profile);
        await _db.SaveChangesAsync(ct);
    }

    public async Task<bool> ExistsAsync(Guid id, CancellationToken ct = default)
        => await _db.MachineProfiles.AnyAsync(x => x.Id == id, ct);
}
