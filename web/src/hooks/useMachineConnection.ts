import { useEffect, useRef, useCallback } from 'react'
import * as signalR from '@microsoft/signalr'
import { useAppStore } from '../store'

interface MachineStatusEvent {
  rawResponse: string
  extruderTempDegC: number | null
  bedTempDegC: number | null
  position: string | null
}

export function useMachineConnection() {
  const connectionRef = useRef<signalR.HubConnection | null>(null)
  const { setMachineConnected, setTemperatures } = useAppStore()

  const buildConnection = useCallback(() => {
    const conn = new signalR.HubConnectionBuilder()
      .withUrl('/hubs/machine')
      .withAutomaticReconnect([0, 2000, 5000, 10000]) // retry delays in ms
      .configureLogging(signalR.LogLevel.Warning)
      .build()

    conn.on('Connected',    ()  => setMachineConnected(true))
    conn.on('Disconnected', ()  => setMachineConnected(false))

    conn.on('MachineStatusChanged', (evt: MachineStatusEvent) => {
      setTemperatures(evt.extruderTempDegC, evt.bedTempDegC)
    })

    conn.onreconnecting(() => setMachineConnected(false))
    conn.onreconnected(()  => setMachineConnected(true))
    conn.onclose(()        => setMachineConnected(false))

    return conn
  }, [setMachineConnected, setTemperatures])

  const connect = useCallback(async (host: string, port: number) => {
    if (!connectionRef.current) {
      connectionRef.current = buildConnection()
      await connectionRef.current.start()
    }
    await connectionRef.current.invoke('Connect', host, port)
  }, [buildConnection])

  const disconnect = useCallback(async () => {
    const conn = connectionRef.current
    if (!conn) return
    await conn.invoke('Disconnect')
    await conn.stop()
    connectionRef.current = null
  }, [])

  const sendCommand = useCallback(async (gcode: string): Promise<string> => {
    const conn = connectionRef.current
    if (!conn) throw new Error('Not connected')
    await conn.invoke('SendManualCommand', gcode)
    return '' // response arrives via 'CommandResponse' event
  }, [])

  const onCommandResponse = useCallback((handler: (r: string) => void) => {
    connectionRef.current?.on('CommandResponse', handler)
    return () => connectionRef.current?.off('CommandResponse', handler)
  }, [])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      connectionRef.current?.stop().catch(() => {})
    }
  }, [])

  return { connect, disconnect, sendCommand, onCommandResponse }
}
