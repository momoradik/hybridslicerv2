using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace HybridSlicer.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class InitialCreate : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "BrandingSettings",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "TEXT", nullable: false),
                    CompanyName = table.Column<string>(type: "TEXT", maxLength: 200, nullable: false),
                    AppTitle = table.Column<string>(type: "TEXT", maxLength: 200, nullable: false),
                    LogoUrl = table.Column<string>(type: "TEXT", nullable: true),
                    PrimaryColor = table.Column<string>(type: "TEXT", maxLength: 20, nullable: false),
                    AccentColor = table.Column<string>(type: "TEXT", maxLength: 20, nullable: false),
                    SupportEmail = table.Column<string>(type: "TEXT", nullable: true),
                    SupportUrl = table.Column<string>(type: "TEXT", nullable: true),
                    UpdatedAt = table.Column<DateTime>(type: "TEXT", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_BrandingSettings", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "CncTools",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "TEXT", nullable: false),
                    Name = table.Column<string>(type: "TEXT", maxLength: 200, nullable: false),
                    Type = table.Column<string>(type: "TEXT", nullable: false),
                    DiameterMm = table.Column<double>(type: "REAL", nullable: false),
                    FluteLengthMm = table.Column<double>(type: "REAL", nullable: false),
                    ShankDiameterMm = table.Column<double>(type: "REAL", nullable: false),
                    FluteCount = table.Column<int>(type: "INTEGER", nullable: false),
                    ToolMaterial = table.Column<string>(type: "TEXT", nullable: false),
                    MaxDepthOfCutMm = table.Column<double>(type: "REAL", nullable: false),
                    RecommendedRpm = table.Column<int>(type: "INTEGER", nullable: false),
                    RecommendedFeedMmPerMin = table.Column<double>(type: "REAL", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "TEXT", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "TEXT", nullable: false),
                    IsDeleted = table.Column<bool>(type: "INTEGER", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_CncTools", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "CustomGCodeBlocks",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "TEXT", nullable: false),
                    Name = table.Column<string>(type: "TEXT", maxLength: 200, nullable: false),
                    GCodeContent = table.Column<string>(type: "TEXT", maxLength: 2147483647, nullable: false),
                    Trigger = table.Column<string>(type: "TEXT", nullable: false),
                    Description = table.Column<string>(type: "TEXT", nullable: true),
                    IsEnabled = table.Column<bool>(type: "INTEGER", nullable: false),
                    SortOrder = table.Column<int>(type: "INTEGER", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "TEXT", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "TEXT", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_CustomGCodeBlocks", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "HybridProcessPlans",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "TEXT", nullable: false),
                    JobId = table.Column<Guid>(type: "TEXT", nullable: false),
                    MachineEveryNLayers = table.Column<int>(type: "INTEGER", nullable: false),
                    TotalPrintLayers = table.Column<int>(type: "INTEGER", nullable: false),
                    OverallSafetyStatus = table.Column<string>(type: "TEXT", nullable: false),
                    GeneratedAt = table.Column<DateTime>(type: "TEXT", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_HybridProcessPlans", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "MachineProfiles",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "TEXT", nullable: false),
                    Name = table.Column<string>(type: "TEXT", maxLength: 200, nullable: false),
                    Type = table.Column<string>(type: "TEXT", nullable: false),
                    BedWidthMm = table.Column<double>(type: "REAL", nullable: false),
                    BedDepthMm = table.Column<double>(type: "REAL", nullable: false),
                    BedHeightMm = table.Column<double>(type: "REAL", nullable: false),
                    NozzleDiameterMm = table.Column<double>(type: "REAL", nullable: false),
                    ExtruderCount = table.Column<int>(type: "INTEGER", nullable: false),
                    IpAddress = table.Column<string>(type: "TEXT", nullable: true),
                    Port = table.Column<int>(type: "INTEGER", nullable: false),
                    CncOffsetX = table.Column<double>(type: "REAL", nullable: false),
                    CncOffsetY = table.Column<double>(type: "REAL", nullable: false),
                    CncOffsetZ = table.Column<double>(type: "REAL", nullable: false),
                    CncOffsetRotDeg = table.Column<double>(type: "REAL", nullable: false),
                    SafeClearanceHeightMm = table.Column<double>(type: "REAL", nullable: false),
                    Version = table.Column<string>(type: "TEXT", maxLength: 20, nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "TEXT", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "TEXT", nullable: false),
                    IsDeleted = table.Column<bool>(type: "INTEGER", nullable: false),
                    ToolOffsets = table.Column<string>(type: "TEXT", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_MachineProfiles", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "Materials",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "TEXT", nullable: false),
                    Name = table.Column<string>(type: "TEXT", maxLength: 200, nullable: false),
                    Type = table.Column<string>(type: "TEXT", maxLength: 50, nullable: false),
                    DensityGPerCm3 = table.Column<double>(type: "REAL", nullable: false),
                    DiameterMm = table.Column<double>(type: "REAL", nullable: false),
                    PrintTempMinDegC = table.Column<int>(type: "INTEGER", nullable: false),
                    PrintTempMaxDegC = table.Column<int>(type: "INTEGER", nullable: false),
                    BedTempMinDegC = table.Column<int>(type: "INTEGER", nullable: false),
                    BedTempMaxDegC = table.Column<int>(type: "INTEGER", nullable: false),
                    GlassTransitionTempDegC = table.Column<int>(type: "INTEGER", nullable: false),
                    Manufacturer = table.Column<string>(type: "TEXT", nullable: true),
                    ColorHex = table.Column<string>(type: "TEXT", nullable: true),
                    CreatedAt = table.Column<DateTime>(type: "TEXT", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "TEXT", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Materials", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "PrintJobs",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "TEXT", nullable: false),
                    Name = table.Column<string>(type: "TEXT", maxLength: 300, nullable: false),
                    StlFilePath = table.Column<string>(type: "TEXT", maxLength: 1000, nullable: false),
                    Status = table.Column<string>(type: "TEXT", nullable: false),
                    MachineProfileId = table.Column<Guid>(type: "TEXT", nullable: false),
                    PrintProfileId = table.Column<Guid>(type: "TEXT", nullable: false),
                    MaterialId = table.Column<Guid>(type: "TEXT", nullable: false),
                    CncToolId = table.Column<Guid>(type: "TEXT", nullable: true),
                    PrintGCodePath = table.Column<string>(type: "TEXT", maxLength: 1000, nullable: true),
                    HybridGCodePath = table.Column<string>(type: "TEXT", maxLength: 1000, nullable: true),
                    TotalPrintLayers = table.Column<int>(type: "INTEGER", nullable: true),
                    ErrorMessage = table.Column<string>(type: "TEXT", nullable: true),
                    CreatedAt = table.Column<DateTime>(type: "TEXT", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "TEXT", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_PrintJobs", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "PrintProfiles",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "TEXT", nullable: false),
                    Name = table.Column<string>(type: "TEXT", maxLength: 200, nullable: false),
                    LayerHeightMm = table.Column<double>(type: "REAL", nullable: false),
                    LineWidthMm = table.Column<double>(type: "REAL", nullable: false),
                    WallCount = table.Column<int>(type: "INTEGER", nullable: false),
                    TopBottomLayers = table.Column<int>(type: "INTEGER", nullable: false),
                    PrintSpeedMmS = table.Column<double>(type: "REAL", nullable: false),
                    TravelSpeedMmS = table.Column<double>(type: "REAL", nullable: false),
                    InfillSpeedMmS = table.Column<double>(type: "REAL", nullable: false),
                    WallSpeedMmS = table.Column<double>(type: "REAL", nullable: false),
                    FirstLayerSpeedMmS = table.Column<double>(type: "REAL", nullable: false),
                    InfillDensityPct = table.Column<double>(type: "REAL", nullable: false),
                    InfillPattern = table.Column<string>(type: "TEXT", nullable: false),
                    PrintTemperatureDegC = table.Column<int>(type: "INTEGER", nullable: false),
                    BedTemperatureDegC = table.Column<int>(type: "INTEGER", nullable: false),
                    RetractLengthMm = table.Column<double>(type: "REAL", nullable: false),
                    RetractSpeedMmS = table.Column<double>(type: "REAL", nullable: false),
                    SupportEnabled = table.Column<bool>(type: "INTEGER", nullable: false),
                    SupportType = table.Column<string>(type: "TEXT", nullable: false),
                    SupportOverhangAngleDeg = table.Column<double>(type: "REAL", nullable: false),
                    CoolingEnabled = table.Column<bool>(type: "INTEGER", nullable: false),
                    CoolingFanSpeedPct = table.Column<int>(type: "INTEGER", nullable: false),
                    FilamentDiameterMm = table.Column<double>(type: "REAL", nullable: false),
                    BrimEnabled = table.Column<bool>(type: "INTEGER", nullable: false),
                    BrimLineCount = table.Column<int>(type: "INTEGER", nullable: false),
                    Version = table.Column<string>(type: "TEXT", maxLength: 20, nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "TEXT", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "TEXT", nullable: false),
                    IsDeleted = table.Column<bool>(type: "INTEGER", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_PrintProfiles", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "ProcessSteps",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "TEXT", nullable: false),
                    PlanId = table.Column<Guid>(type: "TEXT", nullable: false),
                    StepIndex = table.Column<int>(type: "INTEGER", nullable: false),
                    OperationType = table.Column<string>(type: "TEXT", nullable: false),
                    StartLayer = table.Column<int>(type: "INTEGER", nullable: true),
                    EndLayer = table.Column<int>(type: "INTEGER", nullable: true),
                    PrintGCodeFragment = table.Column<string>(type: "TEXT", maxLength: 2147483647, nullable: true),
                    CncGCodeFragment = table.Column<string>(type: "TEXT", maxLength: 2147483647, nullable: true),
                    ToolId = table.Column<Guid>(type: "TEXT", nullable: true),
                    SafetyStatus = table.Column<string>(type: "TEXT", nullable: false),
                    SafetyNotes = table.Column<string>(type: "TEXT", nullable: true),
                    CustomGCodeBlockId = table.Column<Guid>(type: "TEXT", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ProcessSteps", x => x.Id);
                    table.ForeignKey(
                        name: "FK_ProcessSteps_HybridProcessPlans_PlanId",
                        column: x => x.PlanId,
                        principalTable: "HybridProcessPlans",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_ProcessSteps_PlanId",
                table: "ProcessSteps",
                column: "PlanId");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "BrandingSettings");

            migrationBuilder.DropTable(
                name: "CncTools");

            migrationBuilder.DropTable(
                name: "CustomGCodeBlocks");

            migrationBuilder.DropTable(
                name: "MachineProfiles");

            migrationBuilder.DropTable(
                name: "Materials");

            migrationBuilder.DropTable(
                name: "PrintJobs");

            migrationBuilder.DropTable(
                name: "PrintProfiles");

            migrationBuilder.DropTable(
                name: "ProcessSteps");

            migrationBuilder.DropTable(
                name: "HybridProcessPlans");
        }
    }
}
