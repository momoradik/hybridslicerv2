using HybridSlicer.Application.Interfaces;
using Microsoft.AspNetCore.SignalR;

namespace HybridSlicer.Api.Hubs;

/// <summary>
/// SignalR hub for real-time machine communication.
/// Status broadcasting is handled by MachineStatusBroadcaster (IHostedService).
/// </summary>
public sealed class MachineHub : Hub
{
    private readonly IMachineDriver _driver;
    private readonly ILogger<MachineHub> _logger;

    public MachineHub(IMachineDriver driver, ILogger<MachineHub> logger)
    {
        _driver = driver;
        _logger = logger;
    }

    /// <summary>Connect to a RepRapFirmware (or other) machine. Password is optional.</summary>
    public async Task Connect(string host, int port, string? password = null)
    {
        _logger.LogInformation("Hub: Connect {Host}:{Port}", host, port);
        await _driver.ConnectAsync(host, port, password, Context.ConnectionAborted);
        await Clients.Caller.SendAsync("Connected", new { host, port });
    }

    public async Task Disconnect()
    {
        await _driver.DisconnectAsync();
        await Clients.Caller.SendAsync("Disconnected");
    }

    public async Task SendManualCommand(string gcode)
    {
        if (string.IsNullOrWhiteSpace(gcode)) return;
        _logger.LogInformation("Hub: Manual command '{Cmd}'", gcode);
        var response = await _driver.SendCommandWithResponseAsync(gcode, Context.ConnectionAborted);
        await Clients.Caller.SendAsync("CommandResponse", response);
    }

    public async IAsyncEnumerable<object> StreamJob(string gcodePath)
    {
        await foreach (var progress in _driver.StreamFileAsync(gcodePath, Context.ConnectionAborted))
        {
            yield return new
            {
                progress.LineNumber,
                progress.TotalLines,
                progress.LastResponse,
                PercentComplete = (double)progress.LineNumber / progress.TotalLines * 100,
            };
        }
    }
}
