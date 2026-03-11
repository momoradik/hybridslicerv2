namespace HybridSlicer.Domain.Enums;

public enum SafetyStatus
{
    /// <summary>Not yet validated — blocked by default.</summary>
    Unvalidated = 0,

    /// <summary>Fully validated; safe to execute.</summary>
    Clear = 1,

    /// <summary>Potential issue detected; operator must explicitly confirm.</summary>
    Warning = 2,

    /// <summary>Definite collision or limit violation; execution is blocked.</summary>
    Blocked = 3
}
