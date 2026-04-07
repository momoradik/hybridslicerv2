using HybridSlicer.Application.Common;
using HybridSlicer.Application.Interfaces;
using HybridSlicer.Application.Interfaces.Repositories;
using HybridSlicer.Infrastructure.Machine;
using HybridSlicer.Infrastructure.Orchestration;
using HybridSlicer.Infrastructure.Persistence;
using HybridSlicer.Infrastructure.Persistence.Repositories;
using HybridSlicer.Infrastructure.Safety;
using HybridSlicer.Infrastructure.Slicing;
using HybridSlicer.Infrastructure.Toolpath;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;

namespace HybridSlicer.Infrastructure;

/// <summary>
/// Extension method that registers every infrastructure dependency into the DI container.
/// Called once from Program.cs — keeps the host startup file clean.
/// </summary>
public static class ServiceExtensions
{
    public static IServiceCollection AddInfrastructure(
        this IServiceCollection services,
        IConfiguration configuration)
    {
        // ── Options ──────────────────────────────────────────────────────────
        services.Configure<StorageOptions>(configuration.GetSection(StorageOptions.Section));
        services.Configure<CuraEngineOptions>(configuration.GetSection(CuraEngineOptions.Section));

        // Ensure storage root directory exists
        var configuredRoot = configuration[$"{StorageOptions.Section}:Root"];
        var storageRoot = string.IsNullOrWhiteSpace(configuredRoot)
            ? Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                "HybridSlicer")
            : configuredRoot;
        Directory.CreateDirectory(storageRoot);
        Directory.CreateDirectory(Path.Combine(storageRoot, "jobs"));

        // ── Database ─────────────────────────────────────────────────────────
        var rawCs = configuration.GetConnectionString("Default");
        var connectionString = string.IsNullOrWhiteSpace(rawCs)
            ? $"Data Source={Path.Combine(storageRoot, "hybridslicer.db")}"
            : rawCs;

        services.AddDbContext<AppDbContext>(opts =>
            opts.UseSqlite(connectionString)
                .EnableSensitiveDataLogging(false));

        // ── Repositories ─────────────────────────────────────────────────────
        services.AddScoped<IMachineProfileRepository, MachineProfileRepository>();
        services.AddScoped<IPrintProfileRepository,   PrintProfileRepository>();
        services.AddScoped<IPrintJobRepository,       PrintJobRepository>();
        services.AddScoped<ICncToolRepository,        CncToolRepository>();
        services.AddScoped<ICustomGCodeBlockRepository, CustomGCodeBlockRepository>();
        services.AddScoped<IMaterialRepository,       MaterialRepository>();

        // ── Domain Services ──────────────────────────────────────────────────
        services.AddScoped<ISlicingEngine,      CuraEngineAdapter>();
        services.AddScoped<IToolpathPlanner,    ContourToolpathPlanner>();
        services.AddScoped<ISafetyValidator,    CollisionSafetyValidator>();
        services.AddScoped<IHybridOrchestrator, HybridOrchestrator>();
        services.AddSingleton<ICuraGCodeParser, CuraGCodeParser>();   // stateless, reusable

        // Machine driver is Singleton so the connection persists across SignalR hub method calls
        // and across HTTP requests. RepRapHttpDriver uses the HTTP rr_* API for RepRapFirmware.
        // Switch to TcpMachineDriver here for Marlin/raw-TCP machines.
        services.AddSingleton<IMachineDriver, RepRapHttpDriver>();

        return services;
    }
}
