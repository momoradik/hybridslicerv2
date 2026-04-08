using System.Text;
using HybridSlicer.Application.Interfaces;
using HybridSlicer.Application.Interfaces.Repositories;
using HybridSlicer.Domain.Enums;
using HybridSlicer.Domain.Exceptions;
using MediatR;
using Microsoft.Extensions.Logging;
// UnmachinableRegion is defined in IToolpathPlanner.cs (HybridSlicer.Application.Interfaces)

namespace HybridSlicer.Application.UseCases.GenerateToolpaths;

public sealed class GenerateToolpathsHandler : IRequestHandler<GenerateToolpathsCommand, GenerateToolpathsResult>
{
    private readonly IPrintJobRepository     _jobs;
    private readonly IPrintProfileRepository _printProfiles;
    private readonly IMachineProfileRepository _machines;
    private readonly ICncToolRepository      _tools;
    private readonly IToolpathPlanner        _planner;
    private readonly ISafetyValidator        _safety;
    private readonly ICuraGCodeParser        _parser;
    private readonly ILogger<GenerateToolpathsHandler> _logger;

    public GenerateToolpathsHandler(
        IPrintJobRepository jobs,
        IPrintProfileRepository printProfiles,
        IMachineProfileRepository machines,
        ICncToolRepository tools,
        IToolpathPlanner planner,
        ISafetyValidator safety,
        ICuraGCodeParser parser,
        ILogger<GenerateToolpathsHandler> logger)
    {
        _jobs          = jobs;
        _printProfiles = printProfiles;
        _machines      = machines;
        _tools         = tools;
        _planner       = planner;
        _safety        = safety;
        _parser        = parser;
        _logger        = logger;
    }

    public async Task<GenerateToolpathsResult> Handle(
        GenerateToolpathsCommand cmd, CancellationToken ct)
    {
        // ── Load required entities ────────────────────────────────────────────
        var job = await _jobs.GetByIdAsync(cmd.JobId, ct)
            ?? throw new DomainException("JOB_NOT_FOUND", $"Job {cmd.JobId} not found.");

        if (job.TotalPrintLayers is null)
            throw new DomainException("NOT_SLICED", "Job must be sliced before toolpaths can be generated.");

        if (job.PrintGCodePath is null || !File.Exists(job.PrintGCodePath))
            throw new DomainException("NO_GCODE", "Print G-code file not found. Re-slice the job.");

        var machine = await _machines.GetByIdAsync(job.MachineProfileId, ct)
            ?? throw new DomainException("MACHINE_NOT_FOUND", $"Machine profile {job.MachineProfileId} not found.");

        var tool = await _tools.GetByIdAsync(cmd.CncToolId, ct)
            ?? throw new DomainException("TOOL_NOT_FOUND", $"CNC tool {cmd.CncToolId} not found.");

        var profile = await _printProfiles.GetByIdAsync(job.PrintProfileId, ct)
            ?? throw new DomainException("PROFILE_NOT_FOUND", $"Print profile {job.PrintProfileId} not found.");

        // ── Depth-of-cut validation ───────────────────────────────────────────
        var axialDepthMm = cmd.MachineEveryNLayers * profile.LayerHeightMm;
        if (axialDepthMm > tool.MaxDepthOfCutMm)
            _logger.LogWarning(
                "Axial depth {D:F3} mm exceeds tool MaxDepthOfCut {M:F3} mm " +
                "(machineEveryN={N} × layerHeight={H}). Proceeding with caution.",
                axialDepthMm, tool.MaxDepthOfCutMm,
                cmd.MachineEveryNLayers, profile.LayerHeightMm);

        // ── FluteTooShort global check ────────────────────────────────────────
        // If the user's axial depth already exceeds the flute length, flag it immediately.
        var globalFluteTooShort = tool.FluteLengthMm > 0
            && axialDepthMm > tool.FluteLengthMm
            && !cmd.AutoMachiningFrequency;

        // ── Parse Cura G-code for wall paths ─────────────────────────────────
        _logger.LogInformation("Parsing Cura G-code: {Path}", job.PrintGCodePath);
        var gcodeText = await File.ReadAllTextAsync(job.PrintGCodePath, ct);
        var parsed    = await Task.Run(() => _parser.Parse(gcodeText), ct);

        _logger.LogInformation(
            "Parsed {Count} layers from Cura G-code. WALL-OUTER found in {OW} layers.",
            parsed.Layers.Count,
            parsed.Layers.Values.Count(l => l.OuterWallPaths.Count > 0));

        // ── Mark job and prepare output ───────────────────────────────────────
        job.AssignCncTool(cmd.CncToolId);
        job.MarkGeneratingToolpaths();
        await _jobs.UpdateAsync(job, ct);

        var machinedLayers      = new List<int>();
        var allUnmachinableRegions = new List<UnmachinableRegion>();
        var gcodeBuilder        = new StringBuilder();
        gcodeBuilder.AppendLine($"; CNC Toolpath G-code — Job: {job.Name}");
        gcodeBuilder.AppendLine($"; Tool     : {tool.Name}  Ø{tool.DiameterMm} mm  Flute: {tool.FluteLengthMm} mm  Tool length: {tool.ToolLengthMm} mm  Feed: {tool.RecommendedFeedMmPerMin} mm/min  RPM: {tool.RecommendedRpm}");
        gcodeBuilder.AppendLine($"; Nozzle   : Ø{profile.LineWidthMm} mm  Layer height: {profile.LayerHeightMm} mm");
        gcodeBuilder.AppendLine($"; Interval : {(cmd.AutoMachiningFrequency ? "AUTO (flute-based)" : $"every {cmd.MachineEveryNLayers} layer(s)")}  Axial depth: {axialDepthMm:F3} mm");
        gcodeBuilder.AppendLine($"; Options  : MachineInnerWalls={cmd.MachineInnerWalls}  AvoidSupports={cmd.AvoidSupports}  SupportClearance={cmd.SupportClearanceMm:F2} mm  AutoFreq={cmd.AutoMachiningFrequency}");
        gcodeBuilder.AppendLine(cmd.ZSafetyOffsetMm > 0
            ? $"; Z Offset  : +{cmd.ZSafetyOffsetMm:F3} mm — all machining passes raised by this amount above nominal layer height"
            : $"; Z Offset  : none (machining at nominal layer height)");
        gcodeBuilder.AppendLine($"; Spindle   : tip→spindle = {tool.ToolLengthMm:F1} mm  (spindle clears Z+{tool.ToolLengthMm:F1} mm above tip position)");
        gcodeBuilder.AppendLine($"; CRC      : offset = tool_radius({tool.DiameterMm / 2:F3}) + nozzle_radius({profile.LineWidthMm / 2:F3}) = {(tool.DiameterMm + profile.LineWidthMm) / 2:F3} mm outward");
        gcodeBuilder.AppendLine($"; Source   : Cura WALL-OUTER paths (parsed from print.gcode)");
        gcodeBuilder.AppendLine($"; Generated: {DateTime.UtcNow:u}");
        gcodeBuilder.AppendLine();

        // ── Compute which layers to machine ───────────────────────────────────
        // Auto mode: machine when accumulated print height approaches flute reach limit.
        // Manual mode: every N layers as configured.
        IEnumerable<int> layersToMachine;
        if (cmd.AutoMachiningFrequency && tool.FluteLengthMm > 0)
        {
            var autoLayers = new List<int>();
            var safetyMargin = tool.FluteLengthMm * 0.8;
            var lastMachinedZ = 0.0;
            for (var layerIdx = 1; layerIdx <= job.TotalPrintLayers!.Value; layerIdx++)
            {
                var currentZ = layerIdx * profile.LayerHeightMm;
                var pendingHeight = currentZ - lastMachinedZ;
                if (pendingHeight >= safetyMargin)
                {
                    autoLayers.Add(layerIdx);
                    lastMachinedZ = currentZ;
                }
            }
            layersToMachine = autoLayers;
            gcodeBuilder.AppendLine($"; AUTO machining: safety margin = {safetyMargin:F2} mm (flute {tool.FluteLengthMm} mm × 80%)");
            gcodeBuilder.AppendLine($"; AUTO machining: {autoLayers.Count} layers selected");
            gcodeBuilder.AppendLine();
            _logger.LogInformation(
                "Auto machining frequency: flute {F} mm, safety {S} mm → {Count} layers",
                tool.FluteLengthMm, safetyMargin, autoLayers.Count);
        }
        else
        {
            layersToMachine = Enumerable.Range(1, (int)Math.Ceiling((double)job.TotalPrintLayers!.Value / cmd.MachineEveryNLayers))
                .Select(i => i * cmd.MachineEveryNLayers)
                .Where(l => l <= job.TotalPrintLayers!.Value);
        }

        try
        {
            // Handler uses 1-based layer numbers; Cura uses 0-based
            foreach (var layer in layersToMachine)
            {
                var curaLayerIdx = layer - 1;   // convert to Cura 0-based index
                var zHeight      = layer * profile.LayerHeightMm;
                // Apply Z safety offset: raise every machining pass by the configured amount.
                // This adds a consistent safety distance in Z above the nominal layer surface.
                var effectiveZ = zHeight + cmd.ZSafetyOffsetMm;

                _logger.LogDebug("Processing layer {Layer} (Cura ;LAYER:{CI}) Z={Z:F3} effectiveZ={EZ:F3}",
                    layer, curaLayerIdx, zHeight, effectiveZ);

                // ── Spindle clearance pre-check ────────────────────────────────────────
                // When tool tip is at effectiveZ, the spindle collet is at effectiveZ + toolLengthMm.
                // That must stay within the machine Z travel. If not, the spindle body would
                // crash into the machine frame or gantry — skip and log as SpindleCollision.
                if (tool.ToolLengthMm > 0 && effectiveZ + tool.ToolLengthMm > machine.BedHeightMm)
                {
                    var spindleZ = effectiveZ + tool.ToolLengthMm;
                    _logger.LogWarning(
                        "Layer {L}: SpindleCollision — spindle at {SZ:F3} mm (tip {Z:F3} + tool length {TL:F3}) " +
                        "exceeds machine Z limit {MZ:F3} mm — layer skipped",
                        layer, spindleZ, effectiveZ, tool.ToolLengthMm, machine.BedHeightMm);
                    allUnmachinableRegions.Add(new UnmachinableRegion(effectiveZ, "SpindleCollision",
                        new BoundingBox2D(0, 0, 0, 0)));
                    gcodeBuilder.AppendLine(
                        $"; Layer {layer} Z={effectiveZ:F3} mm — SPINDLE COLLISION " +
                        $"(spindle at {spindleZ:F3} mm > machine Z {machine.BedHeightMm} mm) — skipped");
                    gcodeBuilder.AppendLine();
                    continue;
                }

                // ── Tool definition sanity check ──────────────────────────────────────
                if (tool.ToolLengthMm > 0 && tool.FluteLengthMm > tool.ToolLengthMm)
                    _logger.LogWarning(
                        "Tool {Name}: flute length {FL:F2} mm exceeds tool length {TL:F2} mm — invalid tool definition",
                        tool.Name, tool.FluteLengthMm, tool.ToolLengthMm);

                // Look up parsed layer data (try exact match, then nearest below)
                if (!parsed.Layers.TryGetValue(curaLayerIdx, out var layerData))
                {
                    gcodeBuilder.AppendLine($"; Layer {layer} (Z={zHeight:F3} mm) — no Cura data, skipped");
                    gcodeBuilder.AppendLine();
                    _logger.LogDebug("No parsed data for Cura layer {CI}", curaLayerIdx);
                    continue;
                }

                // Support avoidance: note detected supports; they will be passed as forbidden
                // zones to the planner, which clips toolpaths around them (no layer skip).
                var supportPaths = (cmd.AvoidSupports && layerData.SupportPaths.Count > 0)
                    ? layerData.SupportPaths
                    : null;

                if (supportPaths is not null)
                    _logger.LogInformation(
                        "Layer {L}: {S} support segment(s) detected — will clip toolpaths with {C} mm clearance",
                        layer, supportPaths.Count, cmd.SupportClearanceMm);

                // Collect wall paths to machine
                var wallPaths = new List<IReadOnlyList<(double X, double Y)>>(
                    layerData.OuterWallPaths);

                if (cmd.MachineInnerWalls)
                    wallPaths.AddRange(layerData.InnerWallPaths);

                if (wallPaths.Count == 0)
                {
                    gcodeBuilder.AppendLine($"; Layer {layer} (Z={zHeight:F3} mm) — no wall paths found, skipped");
                    gcodeBuilder.AppendLine();
                    _logger.LogDebug("Layer {L}: no wall paths", layer);
                    continue;
                }

                // Generate CNC toolpath from outer wall paths (at effectiveZ = zHeight + zSafetyOffset)
                var outerRequest = new WallPathsRequest(
                    WallPaths:              layerData.OuterWallPaths,
                    ZHeightMm:              effectiveZ,
                    ToolDiameterMm:         tool.DiameterMm,
                    NozzleDiameterMm:       profile.LineWidthMm,
                    FeedRateMmPerMin:       tool.RecommendedFeedMmPerMin,
                    SpindleRpm:             tool.RecommendedRpm,
                    MachineOffset:          machine.CncOffset,
                    SafeClearanceHeightMm:  machine.SafeClearanceHeightMm,
                    IsOuterWall:            true,
                    ClimbMilling:           true,
                    SupportPaths:           supportPaths,
                    SupportClearanceMm:     cmd.SupportClearanceMm);

                var toolpath = await _planner.PlanFromWallPathsAsync(outerRequest, ct);

                // Collect unmachinable regions from the outer toolpath
                if (toolpath.UnmachinableRegions is { Count: > 0 })
                    allUnmachinableRegions.AddRange(toolpath.UnmachinableRegions);

                // Check FluteTooShort for this layer: axial depth must not exceed flute length
                if (tool.FluteLengthMm > 0 && axialDepthMm > tool.FluteLengthMm)
                {
                    var env = new BoundingBox2D(0, 0, 0, 0);
                    allUnmachinableRegions.Add(new UnmachinableRegion(effectiveZ, "FluteTooShort", env));
                }

                // Optionally add inner wall passes
                ToolpathResult? innerToolpath = null;
                if (cmd.MachineInnerWalls && layerData.InnerWallPaths.Count > 0)
                {
                    var innerRequest = outerRequest with
                    {
                        WallPaths   = layerData.InnerWallPaths,
                        IsOuterWall = false,
                    };
                    innerToolpath = await _planner.PlanFromWallPathsAsync(innerRequest, ct);

                    // Collect unmachinable regions from inner toolpath
                    if (innerToolpath.UnmachinableRegions is { Count: > 0 })
                        allUnmachinableRegions.AddRange(innerToolpath.UnmachinableRegions);
                }

                if (toolpath.IsEmpty && (innerToolpath is null || innerToolpath.IsEmpty))
                {
                    gcodeBuilder.AppendLine($"; Layer {layer} (Z={zHeight:F3} mm) — planner returned empty, skipped");
                    gcodeBuilder.AppendLine();
                    _logger.LogDebug("Layer {L}: planner returned empty toolpath", layer);
                    continue;
                }

                // Safety validation
                var combinedGCode = toolpath.GCode
                    + (innerToolpath is { IsEmpty: false } ? "\n" + innerToolpath.GCode : string.Empty);

                var allBounds = toolpath.ToolpathBounds
                    .Concat(innerToolpath?.ToolpathBounds ?? [])
                    .ToList();

                var safetyReq = new SafetyValidationRequest(
                    CncGCode:              combinedGCode,
                    PrintedGeometryBounds: [],
                    MachineMaxX:           machine.BedWidthMm,
                    MachineMaxY:           machine.BedDepthMm,
                    MachineMaxZ:           machine.BedHeightMm,
                    SafeClearanceHeightMm: machine.SafeClearanceHeightMm,
                    ToolRadiusMm:          tool.RadiusMm,
                    ToolLengthMm:          tool.ToolLengthMm);

                var validation = await _safety.ValidateToolpathAsync(safetyReq, ct);

                if (validation.Status == SafetyStatus.Blocked)
                    throw new SafetyException(
                        $"Layer {layer}: {string.Join("; ", validation.Issues)}");

                if (validation.Status == SafetyStatus.Warning)
                    _logger.LogWarning("Safety WARNING at layer {L}: {Issues}",
                        layer, string.Join("; ", validation.Issues));

                gcodeBuilder.AppendLine($"; ── Layer {layer} (nominal Z={zHeight:F3} mm  effective Z={effectiveZ:F3} mm) [{layerData.OuterWallPaths.Count} outer wall segments] ─");
                gcodeBuilder.AppendLine(combinedGCode.TrimEnd());
                gcodeBuilder.AppendLine();

                machinedLayers.Add(layer);
                _logger.LogInformation(
                    "Toolpath OK — layer {L} Z={Z:F3} [{Status}]  {OW} outer + {IW} inner segments",
                    layer, zHeight, validation.Status,
                    layerData.OuterWallPaths.Count, layerData.InnerWallPaths.Count);
            }

            // Write toolpath file
            var jobDir          = Path.GetDirectoryName(job.StlFilePath)!;
            var toolpathGCodePath = Path.Combine(jobDir, "toolpath.gcode");
            await File.WriteAllTextAsync(toolpathGCodePath, gcodeBuilder.ToString(), ct);

            job.MarkToolpathsComplete(toolpathGCodePath);
            await _jobs.UpdateAsync(job, ct);

            _logger.LogInformation(
                "Toolpath generation complete for {JobId}: {Count} layers machined, {UR} unmachinable regions",
                cmd.JobId, machinedLayers.Count, allUnmachinableRegions.Count);

            return new GenerateToolpathsResult(cmd.JobId, machinedLayers.Count, machinedLayers, allUnmachinableRegions);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Toolpath generation failed for job {JobId}", cmd.JobId);
            job.MarkFailed(ex.Message);
            await _jobs.UpdateAsync(job, ct);
            throw;
        }
    }
}
