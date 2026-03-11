using HybridSlicer.Application.Interfaces.Repositories;
using HybridSlicer.Domain.Entities;
using Microsoft.EntityFrameworkCore;

namespace HybridSlicer.Infrastructure.Persistence.Repositories;

public sealed class MaterialRepository : IMaterialRepository
{
    private readonly AppDbContext _db;

    public MaterialRepository(AppDbContext db) => _db = db;

    public Task<Material?> GetByIdAsync(Guid id, CancellationToken ct = default)
        => _db.Materials.FirstOrDefaultAsync(x => x.Id == id, ct);

    public async Task<IReadOnlyList<Material>> GetAllAsync(CancellationToken ct = default)
        => await _db.Materials.OrderBy(x => x.Name).ToListAsync(ct);

    public async Task AddAsync(Material material, CancellationToken ct = default)
    {
        await _db.Materials.AddAsync(material, ct);
        await _db.SaveChangesAsync(ct);
    }

    public async Task UpdateAsync(Material material, CancellationToken ct = default)
    {
        _db.Materials.Update(material);
        await _db.SaveChangesAsync(ct);
    }

    public async Task DeleteAsync(Guid id, CancellationToken ct = default)
    {
        var material = await _db.Materials.FindAsync([id], ct);
        if (material is not null)
        {
            _db.Materials.Remove(material);
            await _db.SaveChangesAsync(ct);
        }
    }
}
