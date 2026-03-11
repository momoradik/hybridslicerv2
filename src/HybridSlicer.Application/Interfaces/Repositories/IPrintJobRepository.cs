using HybridSlicer.Domain.Entities;
using HybridSlicer.Domain.Enums;

namespace HybridSlicer.Application.Interfaces.Repositories;

public interface IPrintJobRepository
{
    Task<PrintJob?> GetByIdAsync(Guid id, CancellationToken ct = default);
    Task<IReadOnlyList<PrintJob>> GetAllAsync(CancellationToken ct = default);
    Task<IReadOnlyList<PrintJob>> GetByStatusAsync(JobStatus status, CancellationToken ct = default);
    Task AddAsync(PrintJob job, CancellationToken ct = default);
    Task UpdateAsync(PrintJob job, CancellationToken ct = default);
}
