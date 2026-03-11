using HybridSlicer.Domain.Entities;
using HybridSlicer.Domain.Enums;

namespace HybridSlicer.Application.Interfaces.Repositories;

public interface ICustomGCodeBlockRepository
{
    Task<CustomGCodeBlock?> GetByIdAsync(Guid id, CancellationToken ct = default);
    Task<IReadOnlyList<CustomGCodeBlock>> GetAllAsync(CancellationToken ct = default);
    Task<IReadOnlyList<CustomGCodeBlock>> GetEnabledAsync(CancellationToken ct = default);
    Task<IReadOnlyList<CustomGCodeBlock>> GetByTriggerAsync(GCodeTrigger trigger, CancellationToken ct = default);
    Task AddAsync(CustomGCodeBlock block, CancellationToken ct = default);
    Task UpdateAsync(CustomGCodeBlock block, CancellationToken ct = default);
    Task DeleteAsync(Guid id, CancellationToken ct = default);
}
