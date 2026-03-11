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
  layerHeightMm: number
  lineWidthMm: number
  wallCount: number
  printSpeedMmS: number
  travelSpeedMmS: number
  infillDensityPct: number
  infillPattern: string
  printTemperatureDegC: number
  bedTemperatureDegC: number
  retractLengthMm: number
  supportEnabled: boolean
  version: string
}

export interface CncTool {
  id: string
  name: string
  type: ToolType
  diameterMm: number
  fluteLengthMm: number
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
  hybridGCodePath?: string
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
