using HybridSlicer.Domain.Entities;

namespace HybridSlicer.Application.Interfaces.Repositories;

public interface IMaterialRepository
{
    Task<Material?> GetByIdAsync(Guid id, CancellationToken ct = default);
    Task<IReadOnlyList<Material>> GetAllAsync(CancellationToken ct = default);
    Task AddAsync(Material material, CancellationToken ct = default);
    Task UpdateAsync(Material material, CancellationToken ct = default);
    Task DeleteAsync(Guid id, CancellationToken ct = default);
}
