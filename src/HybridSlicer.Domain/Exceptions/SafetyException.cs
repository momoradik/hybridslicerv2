namespace HybridSlicer.Domain.Exceptions;

/// <summary>
/// Thrown when a toolpath or motion plan violates a safety constraint.
/// This exception represents a hard block — execution must not proceed.
/// </summary>
public sealed class SafetyException : DomainException
{
    public SafetyException(string reason)
        : base("SAFETY_VIOLATION", $"Safety check failed: {reason}") { }
}
