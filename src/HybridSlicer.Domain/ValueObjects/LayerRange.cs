namespace HybridSlicer.Domain.ValueObjects;

/// <summary>
/// Inclusive layer index range [Start, End].
/// </summary>
public sealed record LayerRange(int Start, int End)
{
    public LayerRange(int singleLayer) : this(singleLayer, singleLayer) { }

    public bool Contains(int layer) => layer >= Start && layer <= End;

    public int Count => End - Start + 1;

    public IEnumerable<int> Layers()
    {
        for (var i = Start; i <= End; i++) yield return i;
    }

    public override string ToString() => Start == End ? $"L{Start}" : $"L{Start}–L{End}";
}
