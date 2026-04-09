export type JobStatus =
  | 'Draft' | 'StlImported' | 'Slicing' | 'SlicingComplete'
  | 'GeneratingToolpaths' | 'ToolpathsComplete' | 'PlanningHybrid'
  | 'Ready' | 'Running' | 'Paused' | 'Complete' | 'Failed'

export type MachineType = 'FDM' | 'CNC' | 'Hybrid'
export type ToolType = 'FlatEndMill' | 'BallEndMill' | 'BullNoseEndMill' | 'DrillBit' | 'Engraver' | 'Facemill' | 'Custom'
export type GCodeTrigger = 'BeforeMachining' | 'AfterMachining' | 'BeforePrinting' | 'AfterPrinting' | 'JobStart' | 'JobEnd'

export interface MachineProfile {
  id: string
  name: string
  type: MachineType
  bedWidthMm: number
  bedDepthMm: number
  bedHeightMm: number
  nozzleDiameterMm: number
  extruderCount: number
  ipAddress?: string
  port: number
  cncOffset: MachineOffset
  safeClearanceHeightMm: number
  version: string
}

export interface MachineOffset {
  x: number
  y: number
  z: number
  rotationDeg: number
}

export interface PrintProfile {
  id: string
  name: string
  // Basic settings
  nozzleDiameterMm: number        // 0 = use machine default; machine_nozzle_size
  layerHeightMm: number           // layer_height
  lineWidthMm: number             // line_width (= nozzle diameter by default)
  materialFlowPct: number         // material_flow
  // Print speeds (mm/s)
  printSpeedMmS: number           // speed_print
  travelSpeedMmS: number          // speed_travel
  wallSpeedMmS: number            // speed_wall_0 (outer wall)
  innerWallSpeedMmS: number       // speed_wall_x (inner wall)
  infillSpeedMmS: number          // speed_infill
  firstLayerSpeedMmS: number      // speed_layer_0
  // Structure
  wallCount: number
  infillDensityPct: number
  infillPattern: string
  // Temperature (°C)
  printTemperatureDegC: number
  bedTemperatureDegC: number
  // Retraction
  retractLengthMm: number
  // Cooling
  coolingEnabled: boolean
  coolingFanSpeedPct: number
  // Support
  supportEnabled: boolean
  pelletModeEnabled: boolean
  virtualFilamentDiameterMm: number
  version: string
}

export interface CncTool {
  id: string
  name: string
  type: ToolType
  diameterMm: number
  fluteLengthMm: number
  /** Overall length from spindle collet face to tool tip (mm). Used for spindle clearance safety. */
  toolLengthMm: number
  shankDiameterMm: number
  fluteCount: number
  toolMaterial: string
  maxDepthOfCutMm: number
  recommendedRpm: number
  recommendedFeedMmPerMin: number
}

export interface PrintJob {
  id: string
  name: string
  stlFilePath: string
  status: JobStatus
  machineProfileId: string
  printProfileId: string
  materialId: string
  cncToolId?: string
  totalPrintLayers?: number
  printGCodePath?: string      // set after slicing
  toolpathGCodePath?: string   // set after generate-toolpaths
  hybridGCodePath?: string     // set after plan-hybrid
  errorMessage?: string
  createdAt: string
  updatedAt: string
}

export interface CustomGCodeBlock {
  id: string
  name: string
  gCodeContent: string
  trigger: GCodeTrigger
  description?: string
  isEnabled: boolean
  sortOrder: number
}

export interface BrandingSettings {
  companyName: string
  appTitle: string
  logoUrl?: string
  primaryColor: string
  accentColor: string
  supportEmail?: string
}

export interface Material {
  id: string
  name: string
  type: string
  printTempMinDegC: number
  printTempMaxDegC: number
  bedTempMinDegC: number
  bedTempMaxDegC: number
  diameterMm: number
}
