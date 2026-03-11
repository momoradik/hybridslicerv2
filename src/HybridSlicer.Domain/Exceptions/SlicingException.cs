namespace HybridSlicer.Domain.Exceptions;

public sealed class SlicingException : DomainException
{
    public int ExitCode { get; }

    public SlicingException(string message, int exitCode = -1)
        : base("SLICING_FAILED", message)
    {
        ExitCode = exitCode;
    }
}
