using HybridSlicer.Domain.Entities;

namespace HybridSlicer.Application.Interfaces.Repositories;

public interface IPrintProfileRepository
{
    Task<PrintProfile?> GetByIdAsync(Guid id, CancellationToken ct = default);
    Task<IReadOnlyList<PrintProfile>> GetAllAsync(CancellationToken ct = default);
    Task AddAsync(PrintProfile profile, CancellationToken ct = default);
    Task UpdateAsync(PrintProfile profile, CancellationToken ct = default);
}
