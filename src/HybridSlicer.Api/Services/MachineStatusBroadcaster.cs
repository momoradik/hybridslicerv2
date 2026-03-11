using HybridSlicer.Application.Interfaces;
using HybridSlicer.Api.Hubs;
using Microsoft.AspNetCore.SignalR;

namespace HybridSlicer.Api.Services;

/// <summary>
/// Subscribes to the singleton IMachineDriver.StatusChanged event and broadcasts
/// temperature/position events to all connected SignalR clients via IHubContext.
/// This avoids the per-connection event leak that would occur if the MachineHub
/// constructor subscribed to the event directly.
/// </summary>
public sealed class MachineStatusBroadcaster : IHostedService
{
    private readonly IMachineDriver _driver;
    private readonly IHubContext<MachineHub> _hub;
    private readonly ILogger<MachineStatusBroadcaster> _logger;

    public MachineStatusBroadcaster(
        IMachineDriver driver,
        IHubContext<MachineHub> hub,
        ILogger<MachineStatusBroadcaster> logger)
    {
        _driver = driver;
        _hub    = hub;
        _logger = logger;
    }

    public Task StartAsync(CancellationToken cancellationToken)
    {
        _driver.StatusChanged += OnStatusChanged;
        _logger.LogInformation("MachineStatusBroadcaster started.");
        return Task.CompletedTask;
    }

    public Task StopAsync(CancellationToken cancellationToken)
    {
        _driver.StatusChanged -= OnStatusChanged;
        return Task.CompletedTask;
    }

    private void OnStatusChanged(object? sender, MachineStatusEvent evt)
    {
        _ = _hub.Clients.All.SendAsync("MachineStatusChanged", new
        {
            evt.RawResponse,
            evt.ExtruderTempDegC,
            evt.BedTempDegC,
            evt.Position,
        });
    }
}
