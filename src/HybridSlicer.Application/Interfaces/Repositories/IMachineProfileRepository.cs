using HybridSlicer.Domain.Entities;

namespace HybridSlicer.Application.Interfaces.Repositories;

public interface IMachineProfileRepository
{
    Task<MachineProfile?> GetByIdAsync(Guid id, CancellationToken ct = default);
    Task<IReadOnlyList<MachineProfile>> GetAllAsync(CancellationToken ct = default);
    Task AddAsync(MachineProfile profile, CancellationToken ct = default);
    Task UpdateAsync(MachineProfile profile, CancellationToken ct = default);
    Task<bool> ExistsAsync(Guid id, CancellationToken ct = default);
}
