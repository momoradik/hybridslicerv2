using MediatR;

namespace HybridSlicer.Application.UseCases.ImportStl;

public sealed record ImportStlCommand(
    string JobName,
    Stream StlStream,
    string OriginalFileName,
    Guid MachineProfileId,
    Guid PrintProfileId,
    Guid MaterialId,
    bool SupportEnabled = false,
    string SupportType = "normal") : IRequest<ImportStlResult>;

public sealed record ImportStlResult(
    Guid JobId,
    string StoredFilePath,
    long FileSizeBytes);
