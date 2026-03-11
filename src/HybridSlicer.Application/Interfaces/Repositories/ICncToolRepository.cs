using HybridSlicer.Domain.Entities;

namespace HybridSlicer.Application.Interfaces.Repositories;

public interface ICncToolRepository
{
    Task<CncTool?> GetByIdAsync(Guid id, CancellationToken ct = default);
    Task<IReadOnlyList<CncTool>> GetAllAsync(CancellationToken ct = default);
    Task AddAsync(CncTool tool, CancellationToken ct = default);
    Task UpdateAsync(CncTool tool, CancellationToken ct = default);
}
