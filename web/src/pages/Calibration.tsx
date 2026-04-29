import { useState, useRef } from 'react'
import { useAppStore } from '../store'
import * as signalR from '@microsoft/signalr'
import DisabledHint from '../components/DisabledHint'

export default function Calibration() {
  const { machineConnected, setMachineConnected, setMachineEndpoint } = useAppStore()

  // Connection fields — default to the RepRapFirmware test machine
  const [host, setHost] = useState('192.168.8.214')
  const [port, setPort] = useState(80)   // RepRapFirmware HTTP port

  // Password prompt modal state
  const [showPassPrompt, setShowPassPrompt] = useState(false)
  const [password, setPassword] = useState('')
  const passInputRef = useRef<HTMLInputElement>(null)

  const [connecting, setConnecting] = useState(false)
  const [manualCmd, setManualCmd] = useState('')
  const [response, setResponse] = useState('')
  const [errorMsg, setErrorMsg] = useState('')

  const connectionRef = useRef<signalR.HubConnection | null>(null)

  const buildHubConnection = () =>
    new signalR.HubConnectionBuilder()
      .withUrl('/hubs/machine')
      .withAutomaticReconnect()
      .build()

  /** Open the password prompt. Called when user clicks "Connect". */
  const openPasswordPrompt = () => {
    setPassword('')
    setErrorMsg('')
    setShowPassPrompt(true)
    setTimeout(() => passInputRef.current?.focus(), 50)
  }

  /** Actually perform the connection after password is confirmed. */
  const doConnect = async (pwd: string) => {
    setShowPassPrompt(false)
    setConnecting(true)
    setErrorMsg('')
    try {
      const conn = buildHubConnection()
      conn.on('Connected',    () => setMachineConnected(true))
      conn.on('Disconnected', () => setMachineConnected(false))
      conn.on('CommandResponse', (r: string) => setResponse(prev => prev + r + '\n'))
      conn.on('MachineStatusChanged', (evt: { extruderTempDegC: number; bedTempDegC: number }) => {
        useAppStore.getState().setTemperatures(evt.extruderTempDegC, evt.bedTempDegC)
      })
      conn.onclose(() => setMachineConnected(false))

      await conn.start()
      // Pass host, port, password to the backend hub
      await conn.invoke('Connect', host, port, pwd)
      connectionRef.current = conn
      setMachineEndpoint(host, port)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      setErrorMsg(`Connection failed: ${msg}`)
      setMachineConnected(false)
    } finally {
      setConnecting(false)
    }
  }

  const disconnect = async () => {
    try {
      await connectionRef.current?.invoke('Disconnect')
      await connectionRef.current?.stop()
    } catch { /* ignore */ }
    connectionRef.current = null
    setMachineConnected(false)
  }

  const sendCmd = async () => {
    if (!connectionRef.current || !manualCmd.trim()) return
    setResponse('')
    await connectionRef.current.invoke('SendManualCommand', manualCmd.trim())
    setManualCmd('')
  }

  return (
    <div className="space-y-6 max-w-2xl">
      <h2 className="text-2xl font-semibold text-white">Machine Calibration</h2>

      {/* ── Connection ─────────────────────────────────────────────────── */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 space-y-4">
        <h3 className="font-medium text-white">Connection</h3>
        <div className="flex gap-3">
          <input
            className="input flex-1"
            value={host}
            onChange={e => setHost(e.target.value)}
            placeholder="IP Address"
            disabled={machineConnected || connecting}
          />
          <input
            className="input w-24"
            type="number"
            value={port}
            onChange={e => setPort(+e.target.value)}
            placeholder="Port"
            disabled={machineConnected || connecting}
          />
          {machineConnected ? (
            <button
              onClick={disconnect}
              className="px-4 py-2 bg-red-700 hover:bg-red-600 text-white rounded-lg text-sm"
            >
              Disconnect
            </button>
          ) : (
            <button
              onClick={openPasswordPrompt}
              disabled={connecting}
              className="px-4 py-2 bg-green-700 hover:bg-green-600 disabled:opacity-50 text-white rounded-lg text-sm"
            >
              {connecting ? 'Connecting…' : 'Connect'}
            </button>
          )}
        </div>

        {/* Status row */}
        <div className="flex items-center gap-2 text-sm">
          <span className={`w-2 h-2 rounded-full ${machineConnected ? 'bg-green-400' : 'bg-gray-600'}`} />
          <span className="text-gray-400">
            {machineConnected ? `Connected to ${host}:${port} (RepRapFirmware)` : 'Not connected'}
          </span>
        </div>

        {errorMsg && (
          <p className="text-red-400 text-sm bg-red-950/40 rounded-lg px-3 py-2">{errorMsg}</p>
        )}
      </div>

      {/* ── Manual Command ──────────────────────────────────────────────── */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 space-y-4">
        <h3 className="font-medium text-white">Manual Command</h3>
        <div className="flex gap-3">
          <input
            className="input flex-1 font-mono text-sm"
            value={manualCmd}
            onChange={e => setManualCmd(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && sendCmd()}
            placeholder="G28 ; home all axes"
          />
          <DisabledHint when={!machineConnected} reason="Connect to a machine first using the connection panel above.">
            <button
              onClick={sendCmd}
              disabled={!machineConnected}
              className="px-4 py-2 bg-primary/80 hover:bg-primary disabled:opacity-40 text-white rounded-lg text-sm"
            >
              Send
            </button>
          </DisabledHint>
        </div>
        {response && (
          <pre className="text-xs font-mono text-green-400 bg-gray-950 rounded p-3 max-h-40 overflow-y-auto">{response}</pre>
        )}
      </div>

      {/* ── Quick Commands ──────────────────────────────────────────────── */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
        <h3 className="font-medium text-white mb-4">Quick Commands</h3>
        <div className="grid grid-cols-3 gap-2">
          {[
            ['Home All', 'G28'],
            ['Home XY', 'G28 X Y'],
            ['Home Z', 'G28 Z'],
            ['Get Position', 'M114'],
            ['Get Temps', 'M105'],
            ['Disable Motors', 'M84'],
          ].map(([label, cmd]) => (
            <DisabledHint key={cmd} when={!machineConnected} reason="Connect to a machine first.">
              <button
                disabled={!machineConnected}
                onClick={() => { setManualCmd(cmd) }}
                className="py-2 px-3 bg-gray-800 hover:bg-gray-700 disabled:opacity-40 text-gray-300 rounded-lg text-sm transition"
              >
                {label}
              </button>
            </DisabledHint>
          ))}
        </div>
      </div>

      {/* ── Password Prompt Modal ───────────────────────────────────────── */}
      {showPassPrompt && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50">
          <div className="bg-gray-900 border border-gray-700 rounded-xl p-6 w-full max-w-sm space-y-4 shadow-2xl">
            <h3 className="font-semibold text-white">Machine Password</h3>
            <p className="text-sm text-gray-400">
              Enter the RepRapFirmware password for <span className="text-white font-mono">{host}</span>.
              Leave blank if no password is set.
            </p>
            <input
              ref={passInputRef}
              type="password"
              className="input w-full"
              value={password}
              onChange={e => setPassword(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && doConnect(password)}
              placeholder="Password (or leave blank)"
              autoComplete="off"
            />
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setShowPassPrompt(false)}
                className="px-4 py-2 bg-gray-800 text-gray-300 rounded-lg text-sm hover:bg-gray-700"
              >
                Cancel
              </button>
              <button
                onClick={() => doConnect(password)}
                className="px-4 py-2 bg-green-700 hover:bg-green-600 text-white rounded-lg text-sm"
              >
                Connect
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
