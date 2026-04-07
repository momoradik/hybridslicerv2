using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;
using HybridSlicer.Application.Interfaces;
using HybridSlicer.Domain.Exceptions;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

namespace HybridSlicer.Infrastructure.Slicing;

/// <summary>
/// Wraps the CuraEngine CLI binary (5.x) to slice STL files.
///
/// Invocation (CuraEngine 5.x):
///   CuraEngine slice -v -p -j fdmprinter.def.json -s key=value ... -e0 -j fdmextruder.def.json -s key=value ... -l model.stl -o output.gcode
///
/// NOTE: The -r (resolved-settings JSON) flag is broken in CuraEngine 5.10.x (causes
/// integer divide-by-zero in GcodeWriter). Use individual -s key=value flags instead.
/// CuraEngine 5.12.0+ is required; 5.10.x crashes during G-code export.
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

        var workDir   = Path.GetDirectoryName(stlFilePath)!;
        var gcodePath = Path.Combine(workDir, "print.gcode");

        // Build args: -j base definition + individual -s flags + -e0 extruder + -l model -o gcode
        var args = BuildArgs(_opts.DefinitionsPath, _opts.ExtruderDefinitionsPath, p, stlFilePath, gcodePath);
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

        // ParseSummary reads process stdout/stderr.  Layer count and time metadata are
        // emitted inside the G-code file itself (not on stdout), so supplement with a
        // scan of the first ~200 lines of the output file where Cura writes ;LAYER_COUNT.
        var gcodeHeader = ReadFirstLines(gcodePath, 200);
        var (totalLayers, timeSec, filamentMm) = ParseSummary(allOutput + "\n" + gcodeHeader);
        _logger.LogInformation("Sliced: {Layers} layers, {Time:F0}s, {Fil:F0} mm filament",
            totalLayers, timeSec, filamentMm);

        return new SlicingResult(gcodePath, totalLayers, timeSec, filamentMm);
    }

    // ── Private ────────────────────────────────────────────────────────────────

    /// <summary>
    /// Builds the CuraEngine slice command arguments using individual -s key=value flags.
    /// The -r flag is intentionally avoided: CuraEngine 5.10.x crashes (integer divide-by-zero
    /// in GcodeWriter) when -r is used. Individual -s flags work correctly in 5.12.0+.
    /// </summary>
    private static string BuildArgs(
        string? definitionsPath,
        string? extruderDefinitionsPath,
        SlicingParameters p,
        string stlPath,
        string gcodePath)
    {
        var sb = new StringBuilder("slice -v -p");

        // Load base fdmprinter definition so CuraEngine knows all setting defaults
        if (!string.IsNullOrWhiteSpace(definitionsPath) && File.Exists(definitionsPath))
            sb.Append($" -j \"{definitionsPath}\"");

        // Global (machine-level) settings
        sb.Append($" -s layer_height={p.LayerHeightMm.ToString("F4", System.Globalization.CultureInfo.InvariantCulture)}");
        sb.Append($" -s layer_height_0={p.LayerHeightMm.ToString("F4", System.Globalization.CultureInfo.InvariantCulture)}");
        sb.Append($" -s line_width={p.LineWidthMm.ToString("F4", System.Globalization.CultureInfo.InvariantCulture)}");
        sb.Append($" -s wall_line_count={p.WallCount}");
        sb.Append($" -s top_layers={p.TopBottomLayers}");
        sb.Append($" -s bottom_layers={p.TopBottomLayers}");
        sb.Append($" -s speed_print={p.PrintSpeedMmS.ToString("F1", System.Globalization.CultureInfo.InvariantCulture)}");
        sb.Append($" -s speed_travel={p.TravelSpeedMmS.ToString("F1", System.Globalization.CultureInfo.InvariantCulture)}");
        sb.Append($" -s speed_infill={p.InfillSpeedMmS.ToString("F1", System.Globalization.CultureInfo.InvariantCulture)}");
        sb.Append($" -s speed_wall={p.WallSpeedMmS.ToString("F1", System.Globalization.CultureInfo.InvariantCulture)}");
        sb.Append($" -s speed_layer_0={p.FirstLayerSpeedMmS.ToString("F1", System.Globalization.CultureInfo.InvariantCulture)}");
        // Infill density — set both the percentage AND the derived line-distance so CuraEngine 5.x
        // cannot fall back to a cached formula value from the definition file.
        // infill_line_distance = (line_width * 100) / infill_sparse_density  (Cura's own formula)
        var infillLineDist = p.InfillDensityPct > 0
            ? (p.LineWidthMm * 100.0) / p.InfillDensityPct
            : 0.0;
        sb.Append($" -s infill_sparse_density={p.InfillDensityPct.ToString("F4", System.Globalization.CultureInfo.InvariantCulture)}");
        sb.Append($" -s infill_line_distance={infillLineDist.ToString("F4", System.Globalization.CultureInfo.InvariantCulture)}");
        sb.Append($" -s infill_pattern={p.InfillPattern}");
        sb.Append($" -s material_print_temperature={p.PrintTemperatureDegC}");
        sb.Append($" -s material_bed_temperature={p.BedTemperatureDegC}");
        sb.Append($" -s support_enable={p.SupportEnabled.ToString().ToLowerInvariant()}");
        if (p.SupportEnabled)
        {
            // support_type = where supports are placed (everywhere or touching_buildplate)
            // support_structure = support geometry type (normal or tree)
            var placement = string.IsNullOrWhiteSpace(p.SupportPlacement) ? "everywhere" : p.SupportPlacement;
            sb.Append($" -s support_type={placement}");
            sb.Append($" -s support_structure={p.SupportType}");
        }
        sb.Append($" -s cool_fan_enabled={p.CoolingEnabled.ToString().ToLowerInvariant()}");
        sb.Append($" -s cool_fan_speed={p.CoolingFanSpeedPct.ToString("F1", System.Globalization.CultureInfo.InvariantCulture)}");
        sb.Append($" -s machine_width={p.BedWidthMm.ToString("F1", System.Globalization.CultureInfo.InvariantCulture)}");
        sb.Append($" -s machine_depth={p.BedDepthMm.ToString("F1", System.Globalization.CultureInfo.InvariantCulture)}");
        sb.Append($" -s machine_height={p.BedHeightMm.ToString("F1", System.Globalization.CultureInfo.InvariantCulture)}");
        sb.Append($" -s machine_nozzle_size={p.NozzleDiameterMm.ToString("F2", System.Globalization.CultureInfo.InvariantCulture)}");
        // The STL viewer and the G-code preview both use an origin at the bed centre
        // (X ∈ [-width/2, +width/2], Y ∈ [-depth/2, +depth/2]).  Tell CuraEngine to
        // use the same convention so model positions and support placement match exactly.
        sb.Append(" -s machine_center_is_zero=true");
        sb.Append(" -s adhesion_type=none");

        // Extruder-0 settings (required in CuraEngine 5.x to avoid "no value given" errors)
        sb.Append(" -e0");
        if (!string.IsNullOrWhiteSpace(extruderDefinitionsPath) && File.Exists(extruderDefinitionsPath))
            sb.Append($" -j \"{extruderDefinitionsPath}\"");
        // Repeat infill settings at extruder level — CuraEngine 5.x resolves some settings
        // per-extruder and will ignore the global value if the extruder context is missing them.
        sb.Append($" -s infill_sparse_density={p.InfillDensityPct.ToString("F4", System.Globalization.CultureInfo.InvariantCulture)}");
        sb.Append($" -s infill_line_distance={infillLineDist.ToString("F4", System.Globalization.CultureInfo.InvariantCulture)}");
        sb.Append($" -s infill_pattern={p.InfillPattern}");
        sb.Append($" -s material_diameter={p.FilamentDiameterMm.ToString("F2", System.Globalization.CultureInfo.InvariantCulture)}");
        sb.Append($" -s machine_nozzle_size={p.NozzleDiameterMm.ToString("F2", System.Globalization.CultureInfo.InvariantCulture)}");
        sb.Append($" -s retraction_amount={p.RetractLengthMm.ToString("F2", System.Globalization.CultureInfo.InvariantCulture)}");
        sb.Append($" -s retraction_speed={p.RetractSpeedMmS.ToString("F1", System.Globalization.CultureInfo.InvariantCulture)}");
        // Required in CuraEngine 5.x — these settings have no default value in fdmextruder.def.json
        // without being explicitly set, causing "Trying to retrieve setting with no value given" errors.
        sb.Append(" -s roofing_layer_count=0");
        sb.Append(" -s flooring_layer_count=0");
        // support_z_seam_away_from_model has no default and causes a segfault in the support generator
        // when support_enable=true and the setting is queried without a value.
        sb.Append(" -s support_z_seam_away_from_model=false");
        // min_wall_line_width has no default and causes a crash during G-code export when
        // tree support is enabled (the tree support generator queries it at export time).
        // Formula: 85% of line_width (same as Cura's internal default formula).
        sb.Append($" -s min_wall_line_width={(p.LineWidthMm * 0.85).ToString("F4", System.Globalization.CultureInfo.InvariantCulture)}");

        // Input model and output G-code — use filenames only because
        // WorkingDirectory is already set to the job's folder.
        sb.Append($" -l \"{Path.GetFileName(stlPath)}\"");
        sb.Append($" -o \"{Path.GetFileName(gcodePath)}\"");

        return sb.ToString();
    }

    private static string ReadFirstLines(string path, int maxLines)
    {
        var sb = new StringBuilder();
        using var sr = new StreamReader(path, Encoding.UTF8);
        for (var i = 0; i < maxLines; i++)
        {
            var line = sr.ReadLine();
            if (line is null) break;
            sb.AppendLine(line);
        }
        return sb.ToString();
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
    /// Example: C:\Program Files\UltiMaker Cura 5.12.0\share\cura\resources\definitions\fdmprinter.def.json
    /// </summary>
    public string DefinitionsPath { get; set; } = "";

    /// <summary>
    /// Path to fdmextruder.def.json for extruder-0 settings (required in CuraEngine 5.x).
    /// Example: C:\Program Files\UltiMaker Cura 5.12.0\share\cura\resources\definitions\fdmextruder.def.json
    /// </summary>
    public string ExtruderDefinitionsPath { get; set; } = "";

    /// <summary>Maximum time to wait for a slice operation before killing the process.</summary>
    public int TimeoutSeconds { get; set; } = 600;
}
