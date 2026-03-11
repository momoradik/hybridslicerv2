namespace HybridSlicer.Domain.Enums;

public enum GCodeTrigger
{
    BeforeMachining = 0,
    AfterMachining = 1,
    BeforePrinting = 2,
    AfterPrinting = 3,
    JobStart = 4,
    JobEnd = 5
}
