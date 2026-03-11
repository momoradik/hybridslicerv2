import { create } from 'zustand'

interface AppState {
  // Active job
  activeJobId: string | null
  setActiveJobId: (id: string | null) => void

  // Machine connection
  machineConnected: boolean
  machineHost: string
  machinePort: number
  setMachineConnected: (v: boolean) => void
  setMachineEndpoint: (host: string, port: number) => void

  // Live job progress
  jobProgress: number
  setJobProgress: (pct: number) => void

  // Machine temps
  extruderTemp: number | null
  bedTemp: number | null
  setTemperatures: (ext: number | null, bed: number | null) => void
}

export const useAppStore = create<AppState>((set) => ({
  activeJobId: null,
  setActiveJobId: (id) => set({ activeJobId: id }),

  machineConnected: false,
  machineHost: '192.168.8.214',
  machinePort: 80,
  setMachineConnected: (v) => set({ machineConnected: v }),
  setMachineEndpoint: (host, port) => set({ machineHost: host, machinePort: port }),

  jobProgress: 0,
  setJobProgress: (pct) => set({ jobProgress: pct }),

  extruderTemp: null,
  bedTemp: null,
  setTemperatures: (ext, bed) => set({ extruderTemp: ext, bedTemp: bed }),
}))
