using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace HybridSlicer.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class MachineProfileExtruderFields : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.RenameColumn(
                name: "NozzleDiameterMm",
                table: "MachineProfiles",
                newName: "RightBedEdgeOffsetMm");

            migrationBuilder.AddColumn<double>(
                name: "InnerWallSpeedMmS",
                table: "PrintProfiles",
                type: "REAL",
                nullable: false,
                defaultValue: 0.0);

            migrationBuilder.AddColumn<double>(
                name: "MaterialFlowPct",
                table: "PrintProfiles",
                type: "REAL",
                nullable: false,
                defaultValue: 0.0);

            migrationBuilder.AddColumn<double>(
                name: "NozzleDiameterMm",
                table: "PrintProfiles",
                type: "REAL",
                nullable: false,
                defaultValue: 0.0);

            migrationBuilder.AddColumn<bool>(
                name: "PelletModeEnabled",
                table: "PrintProfiles",
                type: "INTEGER",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<double>(
                name: "VirtualFilamentDiameterMm",
                table: "PrintProfiles",
                type: "REAL",
                nullable: false,
                defaultValue: 0.0);

            migrationBuilder.AddColumn<double>(
                name: "InfillDensityPct",
                table: "PrintJobs",
                type: "REAL",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "InfillPattern",
                table: "PrintJobs",
                type: "TEXT",
                nullable: false,
                defaultValue: "");

            migrationBuilder.AddColumn<bool>(
                name: "SupportEnabled",
                table: "PrintJobs",
                type: "INTEGER",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<string>(
                name: "SupportPlacement",
                table: "PrintJobs",
                type: "TEXT",
                nullable: false,
                defaultValue: "");

            migrationBuilder.AddColumn<string>(
                name: "SupportType",
                table: "PrintJobs",
                type: "TEXT",
                nullable: false,
                defaultValue: "");

            migrationBuilder.AddColumn<string>(
                name: "ToolpathGCodePath",
                table: "PrintJobs",
                type: "TEXT",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "ExtruderAssignments",
                table: "MachineProfiles",
                type: "TEXT",
                nullable: true);

            migrationBuilder.AddColumn<double>(
                name: "LeftBedEdgeOffsetMm",
                table: "MachineProfiles",
                type: "REAL",
                nullable: false,
                defaultValue: 0.0);

            migrationBuilder.AddColumn<string>(
                name: "NozzleYOffsets",
                table: "MachineProfiles",
                type: "TEXT",
                nullable: false,
                defaultValue: "[]");

            migrationBuilder.AddColumn<double>(
                name: "ToolLengthMm",
                table: "CncTools",
                type: "REAL",
                nullable: false,
                defaultValue: 0.0);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "InnerWallSpeedMmS",
                table: "PrintProfiles");

            migrationBuilder.DropColumn(
                name: "MaterialFlowPct",
                table: "PrintProfiles");

            migrationBuilder.DropColumn(
                name: "NozzleDiameterMm",
                table: "PrintProfiles");

            migrationBuilder.DropColumn(
                name: "PelletModeEnabled",
                table: "PrintProfiles");

            migrationBuilder.DropColumn(
                name: "VirtualFilamentDiameterMm",
                table: "PrintProfiles");

            migrationBuilder.DropColumn(
                name: "InfillDensityPct",
                table: "PrintJobs");

            migrationBuilder.DropColumn(
                name: "InfillPattern",
                table: "PrintJobs");

            migrationBuilder.DropColumn(
                name: "SupportEnabled",
                table: "PrintJobs");

            migrationBuilder.DropColumn(
                name: "SupportPlacement",
                table: "PrintJobs");

            migrationBuilder.DropColumn(
                name: "SupportType",
                table: "PrintJobs");

            migrationBuilder.DropColumn(
                name: "ToolpathGCodePath",
                table: "PrintJobs");

            migrationBuilder.DropColumn(
                name: "ExtruderAssignments",
                table: "MachineProfiles");

            migrationBuilder.DropColumn(
                name: "LeftBedEdgeOffsetMm",
                table: "MachineProfiles");

            migrationBuilder.DropColumn(
                name: "NozzleYOffsets",
                table: "MachineProfiles");

            migrationBuilder.DropColumn(
                name: "ToolLengthMm",
                table: "CncTools");

            migrationBuilder.RenameColumn(
                name: "RightBedEdgeOffsetMm",
                table: "MachineProfiles",
                newName: "NozzleDiameterMm");
        }
    }
}
