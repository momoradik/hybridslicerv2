using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.Json;
using HybridSlicer.Application.Interfaces;
using HybridSlicer.Domain.Exceptions;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

namespace HybridSlicer.Infrastructure.Slicing;

/// <summary>
/// Wraps the CuraEngine CLI binary (5.x) to slice STL files.
///
/// Invocation (CuraEngine 5.x):
///   CuraEngine slice -v -p -j fdmprinter.def.json -r settings.json -l model.stl -o output.gcode
///
/// -j loads the base printer definition (provides all default setting values).
/// -r loads our resolved-settings override JSON (flat key→value pairs as strings).
/// </summary>
public sealed class CuraEngineAdapter : ISlicingEngine
{
    private readonly CuraEngineOptions _opts;
    private readonly ILogger<CuraEngineAdapter> _logger;

    public CuraEngineAdapter(IOptions<CuraEngineOptions> opts, ILogger<CuraEngineAdapter> logger)
    {
        _opts = opts.Value;
        _logger = logger;
    }

    public async Task<SlicingResult> SliceAsync(
        string stlFilePath,
        SlicingParameters p,
        CancellationToken cancellationToken = default)
    {
        // Resolve executable (handles both full paths and PATH-only names)
        var exePath = ResolveExecutable(_opts.ExecutablePath)
            ?? throw new SlicingException(
                $"CuraEngine not found at '{_opts.ExecutablePath}'. " +
                "Set CuraEngine:ExecutablePath to the full path of CuraEngine.exe " +
                "(e.g. C:\\Program Files\\UltiMaker Cura 5.10.1\\CuraEngine.exe).");

        if (!File.Exists(stlFilePath))
            throw new SlicingException($"STL file not found: {stlFilePath}");

        var workDir    = Path.GetDirectoryName(stlFilePath)!;
        var settingsPath = Path.Combine(workDir, "cura_settings.json");
        var gcodePath  = Path.Combine(workDir, "print.gcode");

        // Write resolved-settings JSON (flat string values for CuraEngine -r flag)
        await WriteResolvedSettingsAsync(settingsPath, p, cancellationToken);

        // Build args: -j base definition + -r our settings
        var args = BuildArgs(exePath, _opts.DefinitionsPath, settingsPath, stlFilePath, gcodePath);
        _logger.LogInformation("CuraEngine: {Exe} {Args}", exePath, args);

        var stdout = new StringBuilder();
        var stderr = new StringBuilder();

        using var cts = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        cts.CancelAfter(TimeSpan.FromSeconds(_opts.TimeoutSeconds));

        using var proc = new Process
        {
            StartInfo = new ProcessStartInfo
            {
                FileName               = exePath,
                Arguments              = args,
                RedirectStandardOutput = true,
                RedirectStandardError  = true,
                UseShellExecute        = false,
                CreateNoWindow         = true,
                WorkingDirectory       = workDir,
            },
        };

        proc.OutputDataReceived += (_, e) => { if (e.Data != null) stdout.AppendLine(e.Data); };
        proc.ErrorDataReceived  += (_, e) => { if (e.Data != null) stderr.AppendLine(e.Data); };

        proc.Start();
        proc.BeginOutputReadLine();
        proc.BeginErrorReadLine();

        try
        {
            await proc.WaitForExitAsync(cts.Token);
        }
        catch (OperationCanceledException) when (!cancellationToken.IsCancellationRequested)
        {
            proc.Kill(entireProcessTree: true);
            throw new SlicingException($"CuraEngine timed out after {_opts.TimeoutSeconds}s.");
        }

        var allOutput = stdout + stderr.ToString();

        if (proc.ExitCode != 0)
        {
            _logger.LogError("CuraEngine exit {Code}.\nSTDOUT:\n{Out}\nSTDERR:\n{Err}",
                proc.ExitCode, stdout, stderr);
            throw new SlicingException(
                $"CuraEngine failed (exit {proc.ExitCode}). See server logs for details.\n{stderr}",
                proc.ExitCode);
        }

        if (!File.Exists(gcodePath))
            throw new SlicingException("CuraEngine reported success but produced no G-code file.");

        var (totalLayers, timeSec, filamentMm) = ParseSummary(allOutput);
        _logger.LogInformation("Sliced: {Layers} layers, {Time:F0}s, {Fil:F0} mm filament",
            totalLayers, timeSec, filamentMm);

        return new SlicingResult(gcodePath, totalLayers, timeSec, filamentMm);
    }

    // ── Private ────────────────────────────────────────────────────────────────

    private static string BuildArgs(
        string exePath,
        string? definitionsPath,
        string settingsPath,
        string stlPath,
        string gcodePath)
    {
        var sb = new StringBuilder("slice -v -p");

        // Load base fdmprinter definition so CuraEngine knows all setting defaults
        if (!string.IsNullOrWhiteSpace(definitionsPath) && File.Exists(definitionsPath))
            sb.Append($" -j \"{definitionsPath}\"");
        else
            _WarnNoDefinitions(exePath, definitionsPath);

        // Load our resolved settings (flat key=string-value JSON)
        sb.Append($" -r \"{settingsPath}\"");

        // Input model and output G-code
        sb.Append($" -l \"{stlPath}\"");
        sb.Append($" -o \"{gcodePath}\"");

        return sb.ToString();
    }

    // Static helper to log a warning without needing an ILogger instance in a static method.
    // We use a thread-local trick; in practice this warning is only emitted once on startup.
    private static void _WarnNoDefinitions(string exePath, string? configuredPath)
    {
        // Logged at runtime via the adapter's ILogger — this path is hit only when
        // DefinitionsPath is unconfigured. The slice will still be attempted without
        // the base definition (may fail on CuraEngine 5.x).
        Console.Error.WriteLine(
            $"[CuraEngine] WARNING: DefinitionsPath not set or file not found " +
            $"(configured='{configuredPath}'). " +
            "CuraEngine 5.x requires the base fdmprinter.def.json. " +
            "Set CuraEngine:DefinitionsPath in appsettings.json.");
    }

    /// <summary>
    /// Writes a flat "resolved settings" JSON for the CuraEngine -r flag.
    /// All values are serialized as strings (CuraEngine expects string values in -r files).
    /// </summary>
    private static async Task WriteResolvedSettingsAsync(
        string path,
        SlicingParameters p,
        CancellationToken ct)
    {
        // CuraEngine -r format: flat dictionary, all values as JSON strings
        var settings = new Dictionary<string, string>
        {
            ["layer_height"]               = p.LayerHeightMm.ToString("F4"),
            ["layer_height_0"]             = p.LayerHeightMm.ToString("F4"),
            ["line_width"]                 = p.LineWidthMm.ToString("F4"),
            ["wall_line_count"]            = p.WallCount.ToString(),
            ["top_layers"]                 = p.TopBottomLayers.ToString(),
            ["bottom_layers"]              = p.TopBottomLayers.ToString(),
            ["speed_print"]                = p.PrintSpeedMmS.ToString("F1"),
            ["speed_travel"]               = p.TravelSpeedMmS.ToString("F1"),
            ["speed_infill"]               = p.InfillSpeedMmS.ToString("F1"),
            ["speed_wall"]                 = p.WallSpeedMmS.ToString("F1"),
            ["speed_layer_0"]              = p.FirstLayerSpeedMmS.ToString("F1"),
            ["infill_sparse_density"]      = p.InfillDensityPct.ToString("F1"),
            ["infill_pattern"]             = p.InfillPattern,
            ["material_print_temperature"] = p.PrintTemperatureDegC.ToString("F1"),
            ["material_bed_temperature"]   = p.BedTemperatureDegC.ToString("F1"),
            ["retraction_amount"]          = p.RetractLengthMm.ToString("F2"),
            ["retraction_speed"]           = p.RetractSpeedMmS.ToString("F1"),
            ["support_enable"]             = p.SupportEnabled ? "true" : "false",
            ["support_type"]               = p.SupportType,
            ["cool_fan_enabled"]           = p.CoolingEnabled ? "true" : "false",
            ["cool_fan_speed"]             = p.CoolingFanSpeedPct.ToString("F1"),
            ["material_diameter"]          = p.FilamentDiameterMm.ToString("F2"),
            ["machine_width"]              = p.BedWidthMm.ToString("F1"),
            ["machine_depth"]              = p.BedDepthMm.ToString("F1"),
            ["machine_height"]             = p.BedHeightMm.ToString("F1"),
            ["machine_nozzle_size"]        = p.NozzleDiameterMm.ToString("F2"),
            ["adhesion_type"]              = "none",
        };

        var json = JsonSerializer.Serialize(settings, new JsonSerializerOptions { WriteIndented = true });
        await File.WriteAllTextAsync(path, json, ct);
    }

    private static (int layers, double timeSec, double filamentMm) ParseSummary(string output)
    {
        int    layers     = 0;
        double timeSec    = 0;
        double filamentMm = 0;

        foreach (var line in output.Split('\n', StringSplitOptions.RemoveEmptyEntries))
        {
            var t = line.Trim();
            if (t.StartsWith(";LAYER_COUNT:", StringComparison.OrdinalIgnoreCase))
                int.TryParse(t[13..], out layers);
            else if (t.StartsWith(";TIME:", StringComparison.OrdinalIgnoreCase))
                double.TryParse(t[6..], out timeSec);
            else if (t.StartsWith(";Filament used:", StringComparison.OrdinalIgnoreCase))
            {
                var raw = t[15..].Trim().TrimEnd('m', 'M');
                if (double.TryParse(raw, out var metres)) filamentMm = metres * 1000;
            }
        }

        return (Math.Max(layers, 1), timeSec, filamentMm);
    }

    /// <summary>
    /// Resolves an executable name or path.
    /// Handles: full paths, relative paths, names on PATH, and common Cura install locations.
    /// </summary>
    private static string? ResolveExecutable(string nameOrPath)
    {
        if (string.IsNullOrWhiteSpace(nameOrPath)) return null;

        // Absolute or relative path with directory separator
        if (Path.IsPathRooted(nameOrPath) || nameOrPath.Contains(Path.DirectorySeparatorChar) || nameOrPath.Contains('/'))
            return File.Exists(nameOrPath) ? nameOrPath : null;

        // Name only — check current directory first
        if (File.Exists(nameOrPath)) return Path.GetFullPath(nameOrPath);

        // Add .exe on Windows
        var candidates = RuntimeInformation.IsOSPlatform(OSPlatform.Windows) && !nameOrPath.EndsWith(".exe", StringComparison.OrdinalIgnoreCase)
            ? [nameOrPath, nameOrPath + ".exe"]
            : new[] { nameOrPath };

        // Search PATH
        var pathEnv = Environment.GetEnvironmentVariable("PATH") ?? "";
        foreach (var dir in pathEnv.Split(Path.PathSeparator, StringSplitOptions.RemoveEmptyEntries))
        foreach (var name in candidates)
        {
            var full = Path.Combine(dir.Trim(), name);
            if (File.Exists(full)) return full;
        }

        // Common Cura install locations on Windows
        if (RuntimeInformation.IsOSPlatform(OSPlatform.Windows))
        {
            var searchRoots = new[]
            {
                Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles),
                Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86),
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Programs"),
            };

            foreach (var root in searchRoots.Where(Directory.Exists))
            foreach (var dir in Directory.GetDirectories(root)
                         .Where(d => Path.GetFileName(d).Contains("Cura", StringComparison.OrdinalIgnoreCase)
                                  || Path.GetFileName(d).Contains("UltiMaker", StringComparison.OrdinalIgnoreCase)))
            foreach (var name in candidates)
            {
                var full = Path.Combine(dir, name);
                if (File.Exists(full)) return full;
            }
        }

        return null;
    }
}

public sealed class CuraEngineOptions
{
    public const string Section = "CuraEngine";

    /// <summary>
    /// Full path to CuraEngine.exe, or just "CuraEngine" if it is on the system PATH.
    /// Example: C:\Program Files\UltiMaker Cura 5.10.1\CuraEngine.exe
    /// </summary>
    public string ExecutablePath { get; set; } = "CuraEngine";

    /// <summary>
    /// Path to the base fdmprinter.def.json required by CuraEngine 5.x.
    /// Example: C:\Program Files\UltiMaker Cura 5.10.1\share\cura\resources\definitions\fdmprinter.def.json
    /// Leave empty to skip (slice may fail on CuraEngine 5.x without this).
    /// </summary>
    public string DefinitionsPath { get; set; } = "";

    /// <summary>Maximum time to wait for a slice operation before killing the process.</summary>
    public int TimeoutSeconds { get; set; } = 600;
}
