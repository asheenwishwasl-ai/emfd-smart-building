"use client"

import {
  Building2, Zap, Thermometer, AlertTriangle, Activity,
  TrendingUp, Moon, Sun, Calendar, Home, Loader2, Wifi, WifiOff, LogOut,
  ChevronDown, ChevronUp, RotateCcw, Receipt
} from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  LineChart, Line, AreaChart, Area,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell
} from 'recharts'
import { useEffect, useState, useRef, useCallback } from 'react'
import { useTheme } from 'next-themes'
import { toast } from 'sonner'
import Link from 'next/link'
import { signOut, useSession } from 'next-auth/react'
import { NotificationBell } from '@/components/notification-bell'

interface SensorReading {
  device_id: string
  temperature: number
  voltage: number
  current: number
  power: number
  energy_kwh: number
  flame: number
  power_factor: number
  monthly_kwh?: number        // [NEW] monthly energy accumulator from ESP32
  monthly_bill_lkr?: number   // [NEW] estimated CEB D1 bill (LKR)
  createdAt: string
  _demo?: boolean
}

const DEVICE_ID = process.env.NEXT_PUBLIC_DEVICE_ID || 'building-01'
const FAULT_COLORS = ['#ef4444', '#f97316', '#eab308', '#3b82f6', '#6b7280']

export default function DashboardPage() {
  const { theme, setTheme } = useTheme()
  const { data: session } = useSession()
  const [mounted, setMounted] = useState(false)
  const [deviceId, setDeviceId] = useState(process.env.NEXT_PUBLIC_DEVICE_ID || 'building-01')
  const [devices, setDevices] = useState<string[]>([])
  const [live, setLive] = useState<SensorReading | null>(null)
  const [isConnected, setIsConnected] = useState(false)
  const [isDeviceOnline, setIsDeviceOnline] = useState(false)
  const [lastUpdate, setLastUpdate] = useState('')
  const [secsSinceUpdate, setSecsSinceUpdate] = useState(0)
  const [electricalHistory, setElectricalHistory] = useState<{time:string;timestamp?:number;voltage:number;current:number;power:number}[]>([])
  const [tempHistory, setTempHistory] = useState<{time:string;timestamp?:number;temperature:number}[]>([])

  useEffect(() => {
    const fetchInitialHistory = async () => {
      try {
        const res = await fetch(`/api/history?device_id=${deviceId}&range=10min`)
        const data = await res.json()
        if (data.data && Array.isArray(data.data)) {
          const reversed = [...data.data].reverse()
          const electHistory = reversed.map((r: any) => ({
            time: new Date(r.createdAt).toLocaleTimeString(),
            timestamp: new Date(r.createdAt).getTime(),
            voltage: r.voltage,
            current: r.current,
            power: r.power
          }))
          const thermalHistory = reversed.map((r: any) => ({
            time: new Date(r.createdAt).toLocaleTimeString(),
            timestamp: new Date(r.createdAt).getTime(),
            temperature: r.temperature
          }))
          setElectricalHistory(electHistory)
          setTempHistory(thermalHistory)
        }
      } catch (err) {
        console.error('Failed to fetch initial history:', err)
      }
    }
    fetchInitialHistory()
  }, [deviceId])

  useEffect(() => {
    const fetchDevices = async () => {
      try {
        const res = await fetch('/api/devices')
        const data = await res.json()
        if (data.devices) {
          setDevices(data.devices)
        }
      } catch (err) {
        console.error('Failed to fetch devices', err)
      }
    }
    fetchDevices()
    const interval = setInterval(fetchDevices, 10000)
    return () => clearInterval(interval)
  }, [])

  const [faultData, setFaultData] = useState([
    { name: 'Overcurrent',         value: 0, color: FAULT_COLORS[0] },
    { name: 'Overheating',         value: 0, color: FAULT_COLORS[1] },
    { name: 'Voltage Fluctuation', value: 0, color: FAULT_COLORS[2] },
    { name: 'Flame Detected',      value: 0, color: '#ef4444' },
  ])
  const [alertHistory, setAlertHistory] = useState<{id:string; title:string; message:string; time:string; type:'critical'|'warning'|'info'}[]>([])
  const [measurementHistory, setMeasurementHistory] = useState<{id:string; time:string; voltage:number; current:number; temperature:number; power:number}[]>([])
  const [isFlowTableOpen, setIsFlowTableOpen] = useState(false)
  const [flowView, setFlowView] = useState<'alerts' | 'data'>('alerts')
  const prevFlame = useRef(0)
  const esRef = useRef<EventSource | null>(null)

  // ── Billing reset dialog state ──────────────────────────────────────────
  const [showResetDialog, setShowResetDialog] = useState(false)
  const [isResetting, setIsResetting]         = useState(false)

  useEffect(() => { 
    setMounted(true)
    setTheme('dark') // Force dark mode for futuristic UI
  }, [setTheme])

  const connectSSE = useCallback(() => {
    if (esRef.current) esRef.current.close()
    const es = new EventSource(`/api/live?device_id=${deviceId}`)
    esRef.current = es
    es.onmessage = (event) => {
      const data = JSON.parse(event.data)
      if (data.type === 'connected') { setIsConnected(true); return }
      
      // Check for device status even if it's not a full reading
      if (data.online !== undefined) {
        setIsDeviceOnline(data.online)
      }

      if (data.type !== 'reading') {
        if (data.type === 'waiting') {
          setIsDeviceOnline(false)
          setLive(null) // Clear stale values
        }
        return
      }

      const reading: any = data
      setLive(reading)
      setIsConnected(true)
      setIsDeviceOnline(reading.online ?? true)
      setSecsSinceUpdate(0)
      const t = new Date(reading.createdAt).toLocaleTimeString()
      const ts = new Date(reading.createdAt).getTime()
      setLastUpdate(t)
      
      setElectricalHistory(prev => {
        const updated = [...prev, { time: t, timestamp: ts, voltage: reading.voltage, current: reading.current, power: reading.power }]
        const cutoff = ts - 10 * 60 * 1000 // 10 minutes
        return updated.filter(item => (item.timestamp || ts) >= cutoff)
      })
      
      setTempHistory(prev => {
        const updated = [...prev, { time: t, timestamp: ts, temperature: reading.temperature }]
        const cutoff = ts - 10 * 60 * 1000 // 10 minutes
        return updated.filter(item => (item.timestamp || ts) >= cutoff)
      })
      
      // Update Fault Data based on REAL data
      setFaultData(prev => prev.map(f => {
        if (f.name === 'Overcurrent' && reading.current > 15) return { ...f, value: f.value + 1 }
        if (f.name === 'Overheating' && reading.temperature > 50) return { ...f, value: f.value + 1 }
        if (f.name === 'Voltage Fluctuation' && reading.voltage > 10 && (reading.voltage < 190 || reading.voltage > 250)) return { ...f, value: f.value + 1 }
        if (f.name === 'Flame Detected' && reading.flame === 1) return { ...f, value: f.value + 1 }
        return f
      }))
      const addAlert = (title: string, message: string, type: 'critical' | 'warning' | 'info') => {
        setAlertHistory(prev => [
          { id: Date.now().toString() + Math.random(), title, message, time: new Date().toLocaleTimeString(), type },
          ...prev
        ].slice(0, 50))
      }

      // Add to measurement history
      setMeasurementHistory(prev => [
        { 
          id: Date.now().toString() + Math.random(), 
          time: t, 
          voltage: reading.voltage, 
          current: reading.current, 
          temperature: reading.temperature,
          power: reading.power 
        },
        ...prev
      ].slice(0, 50))

      if (reading.flame === 1 && prevFlame.current === 0) {
        addAlert('🔥 FLAME DETECTED!', 'Immediate action required!', 'critical')
      }
      prevFlame.current = reading.flame
      if (reading.temperature > 55) addAlert('🌡️ Critical Temp', `${reading.temperature}°C reached`, 'critical')
      if (reading.voltage > 10 && (reading.voltage < 195 || reading.voltage > 250)) addAlert('⚡ Voltage Alert', `${reading.voltage}V - Out of range`, 'warning')
    }
    es.onerror = () => { 
      setIsConnected(false)
      setIsDeviceOnline(false)
      es.close()
      setTimeout(connectSSE, 5000) 
    }
  }, [deviceId])

  useEffect(() => { connectSSE(); return () => esRef.current?.close() }, [connectSSE])
  useEffect(() => { const t = setInterval(() => setSecsSinceUpdate(s => s + 1), 1000); return () => clearInterval(t) }, [])

  const [isAlertsOpen, setIsAlertsOpen] = useState(true)

  // ── Remote billing reset ─────────────────────────────────────────────────
  async function handleResetBilling() {
    setIsResetting(true)
    try {
      const res = await fetch('/api/reset-billing', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ device_id: deviceId }),
      })
      const data = await res.json()
      if (res.ok) {
        toast.success('Billing reset queued — ESP32 will zero monthly units on next upload.', { duration: 5000 })
      } else {
        toast.error(data.error || 'Reset failed. Please try again.')
      }
    } catch {
      toast.error('Network error — could not reach the server.')
    } finally {
      setIsResetting(false)
      setShowResetDialog(false)
    }
  }

  const criticalAlerts = alertHistory.filter(a => a.type === 'critical').length
  const totalFaults = faultData.reduce((s, f) => s + f.value, 0)
  if (!mounted) return null

  return (
    <div className="flex h-screen w-full bg-[#0B1120] text-white overflow-hidden relative font-sans">
      {/* Dark Futuristic Background */}
      <div 
        className="absolute inset-0 z-0 bg-cover bg-center"
        style={{ backgroundImage: 'url(/cyber-bg.png)' }}
      ></div>
      {/* Background Blur Overlay & Dark Gradient Masking */}
      <div className="absolute inset-0 z-0 backdrop-blur-[6px] pointer-events-none"></div>
      <div className="absolute inset-0 z-0 bg-gradient-to-b from-[#0B1120]/60 via-[#0B1120]/80 to-[#0B1120] pointer-events-none"></div>

      {/* Animated Flow Lines Overlay */}
      <div className="absolute inset-0 z-0 overflow-hidden pointer-events-none opacity-40">
        <div className="flow-line"></div>
        <div className="flow-line"></div>
        <div className="flow-line"></div>
        <div className="flow-line"></div>
        <div className="flow-line"></div>
      </div>

      {/* Futuristic Sidebar Navigation */}
      <aside className="relative z-10 w-20 hover:w-64 transition-all duration-300 bg-[#111827]/60 backdrop-blur-xl border-r border-cyan-500/20 flex flex-col items-center py-6 group overflow-hidden shadow-[4px_0_24px_rgba(0,255,255,0.05)]">
        <div className="flex items-center gap-4 px-4 w-full mb-10 overflow-hidden">
          <Building2 className="h-8 w-8 text-cyan-400 shrink-0 neon-pulse-cyan drop-shadow-[0_0_8px_rgba(0,255,255,0.8)]" />
          <span className="font-bold text-xl text-white whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity tracking-widest neon-text-cyan">EMFD</span>
        </div>
        
        <nav className="flex flex-col gap-4 w-full px-4 flex-1">
          <Link href="/dashboard" className="flex items-center gap-4 p-3 rounded-lg bg-cyan-900/40 border border-cyan-500/50 text-cyan-300 transition-all shadow-[0_0_15px_rgba(0,255,255,0.2)]">
            <Home className="h-5 w-5 shrink-0" />
            <span className="whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity font-medium tracking-wide">Dashboard</span>
          </Link>
          <Link href="/historical" className="flex items-center gap-4 p-3 rounded-lg hover:bg-white/10 text-gray-400 hover:text-cyan-100 transition-all">
            <Calendar className="h-5 w-5 shrink-0" />
            <span className="whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity tracking-wide">Historical Data</span>
          </Link>
          {/* Flow Table Toggle inside Sidebar */}
          <button onClick={() => setIsFlowTableOpen(!isFlowTableOpen)} className={`flex items-center gap-4 p-3 rounded-lg transition-all ${isFlowTableOpen ? 'bg-cyan-900/40 border border-cyan-500/50 text-cyan-300 shadow-[0_0_15px_rgba(0,255,255,0.2)]' : 'hover:bg-white/10 text-gray-400 hover:text-cyan-100'}`}>
            <Activity className="h-5 w-5 shrink-0" />
            <span className="whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity tracking-wide flex-1 text-left">System Flow</span>
            {alertHistory.length > 0 && (
              <span className="flex h-5 w-5 items-center justify-center rounded-full bg-red-500/80 border border-red-400 text-[10px] text-white animate-pulse neon-pulse-red shrink-0">
                {alertHistory.length > 9 ? '9+' : alertHistory.length}
              </span>
            )}
          </button>
        </nav>

        <div className="w-full px-4 mt-auto">
          <button onClick={() => signOut({ callbackUrl: '/' })} className="flex items-center gap-4 p-3 rounded-lg hover:bg-red-900/40 hover:border-red-500/50 hover:shadow-[0_0_15px_rgba(239,68,68,0.2)] text-gray-400 hover:text-red-300 w-full transition-all border border-transparent">
            <LogOut className="h-5 w-5 shrink-0" />
            <span className="whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity tracking-wide">Sign Out</span>
          </button>
        </div>
      </aside>

      {/* Main SCADA Content Area */}
      <main className="relative z-10 flex-1 overflow-y-auto p-6 scroll-smooth custom-scrollbar">
        
        {/* HEADER */}
        <div className="mb-8 flex flex-wrap items-center justify-between gap-4 animate-fadeInDown">
          <div>
            <h1 className="text-3xl font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 to-blue-600 drop-shadow-[0_0_10px_rgba(0,255,255,0.3)] uppercase tracking-wider">
              Smart Energy Grid
            </h1>
            {session?.user?.email && <p className="text-sm text-cyan-200/60 font-mono mt-1">OPERATOR: {session.user.email}</p>}
          </div>
          
          <div className="flex flex-wrap items-center gap-4">
            <NotificationBell liveData={live} />

            {/* Device Dropdown Selector */}
            <div className="flex items-center gap-2 bg-[#111827]/60 border border-cyan-500/20 px-3 py-2 rounded-md backdrop-blur-sm shadow-[0_0_15px_rgba(0,255,255,0.02)]">
              <span className="text-xs font-mono text-cyan-200/50 uppercase tracking-wider">UNIT:</span>
              <select
                value={deviceId}
                onChange={(e) => {
                  setDeviceId(e.target.value)
                  setLive(null)
                  setElectricalHistory([])
                  setTempHistory([])
                  setSecsSinceUpdate(0)
                  setLastUpdate('')
                }}
                className="bg-transparent text-cyan-400 font-mono text-xs outline-none cursor-pointer pr-2 uppercase font-bold focus:text-cyan-300"
              >
                {devices.length === 0 ? (
                  <option value={deviceId} className="bg-[#0B1120] text-cyan-400">{deviceId}</option>
                ) : (
                  devices.map((d) => (
                    <option key={d} value={d} className="bg-[#0B1120] text-cyan-400">
                      {d}
                    </option>
                  ))
                )}
              </select>
            </div>
            
            {/* Connection Status Badge */}
            <div className={`flex items-center gap-2 rounded-md px-4 py-2 text-sm font-mono tracking-wider transition-all border backdrop-blur-md ${
              isConnected && isDeviceOnline 
                ? 'bg-cyan-900/30 text-cyan-400 border-cyan-500/50 shadow-[0_0_15px_rgba(0,255,255,0.2)]' 
                : isConnected 
                  ? 'bg-yellow-900/30 text-yellow-400 border-yellow-500/50 shadow-[0_0_15px_rgba(234,179,8,0.2)]'
                  : 'bg-red-900/30 text-red-400 border-red-500/50 shadow-[0_0_15px_rgba(239,68,68,0.2)]'
            }`}>
              {!isConnected ? (
                <><WifiOff className="h-4 w-4" /> LINK LOST</>
              ) : isDeviceOnline ? (
                <><Wifi className="h-4 w-4 animate-pulse neon-text-cyan" /> ESP32 ONLINE</>
              ) : (
                <><WifiOff className="h-4 w-4" /> ESP32 OFFLINE</>
              )}
            </div>
            
            <span className="text-xs text-cyan-200/40 font-mono bg-[#111827]/60 px-3 py-1.5 rounded-md border border-cyan-500/10 backdrop-blur-sm">SYNC: {lastUpdate} ({secsSinceUpdate}s)</span>
          </div>
        </div>

        {/* FLAME BANNER */}
        {live?.flame === 1 && (
          <div className="mb-6 animate-pulse rounded-lg border border-red-500 bg-red-900/40 backdrop-blur-md p-4 text-center shadow-[0_0_30px_rgba(239,68,68,0.4)]">
            <p className="text-2xl font-black text-red-400 tracking-widest neon-text-red">🔥 FLAME DETECTED – EVACUATE IMMEDIATELY</p>
          </div>
        )}

        {/* CRITICAL ALERTS - FOLDABLE PANEL */}
        {criticalAlerts > 0 && (
          <div className="mb-6 rounded-lg border border-red-500/50 bg-red-900/20 backdrop-blur-md animate-slideInLeft overflow-hidden shadow-[0_0_20px_rgba(239,68,68,0.15)]">
            <button 
              onClick={() => setIsAlertsOpen(!isAlertsOpen)}
              className="flex w-full items-center justify-between p-4 transition-colors hover:bg-red-900/40"
            >
              <div className="flex items-center gap-3">
                <AlertTriangle className="h-6 w-6 text-red-400 neon-pulse-red" />
                <h2 className="font-bold text-lg text-red-300 tracking-wide">SYSTEM ALERTS ({criticalAlerts})</h2>
              </div>
              {isAlertsOpen ? <ChevronUp className="h-5 w-5 text-red-400" /> : <ChevronDown className="h-5 w-5 text-red-400" />}
            </button>
            
            {isAlertsOpen && (
              <div className="grid gap-3 p-4 pt-0 md:grid-cols-2 lg:grid-cols-3 animate-fadeIn">
                {alertHistory.filter(a => a.type === 'critical').map((alert) => (
                  <div key={alert.id} className="rounded-md bg-[#111827]/80 p-4 border border-red-500/30 shadow-inner">
                    <p className="text-sm font-bold text-red-400">{alert.title}</p>
                    <p className="text-xs text-red-200 mt-1 opacity-80">{alert.message}</p>
                    <div className="mt-3 flex items-center justify-between border-t border-red-500/20 pt-2">
                      <span className="text-[10px] font-mono text-red-400 bg-red-950 px-2 py-1 rounded border border-red-500/30">CRITICAL</span>
                      <span className="text-[10px] text-red-300/50 font-mono">{alert.time}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* SUMMARY CARDS */}
        <div className="mb-8 grid gap-5 md:grid-cols-2 lg:grid-cols-4">
          
          <div className="animate-fadeInUp" style={{ animationDelay: '0.1s' }}>
            <Card className="glass-card hover:scale-[1.02] transition-transform duration-300"><CardContent className="p-5">
              <div className="flex items-center justify-between">
                <div><p className="text-xs font-mono text-cyan-200/70 tracking-widest uppercase">Voltage</p>
                  <p className="text-3xl font-black mt-1 text-white neon-text-cyan">{live?.voltage !== undefined ? live.voltage.toFixed(1) : '—'}</p>
                </div>
                <div className="rounded-xl bg-cyan-950/50 border border-cyan-500/30 p-3"><Wifi className="h-6 w-6 text-cyan-400" /></div>
              </div>
              <div className="mt-3 flex items-center justify-between">
                <p className="text-[10px] font-mono text-cyan-200/50">MAINS INPUT</p>
                <p className="text-xs font-bold text-cyan-400">V</p>
              </div>
            </CardContent></Card>
          </div>

          <div className="animate-fadeInUp" style={{ animationDelay: '0.2s' }}>
            <Card className="glass-card hover:scale-[1.02] transition-transform duration-300"><CardContent className="p-5">
              <div className="flex items-center justify-between">
                <div><p className="text-xs font-mono text-yellow-200/70 tracking-widest uppercase">Current</p>
                  <p className="text-3xl font-black mt-1 text-white neon-text-yellow">{live?.current !== undefined ? live.current.toFixed(2) : '—'}</p>
                </div>
                <div className="rounded-xl bg-yellow-950/50 border border-yellow-500/30 p-3"><Activity className="h-6 w-6 text-yellow-400" /></div>
              </div>
              <div className="mt-3 flex items-center justify-between">
                <p className="text-[10px] font-mono text-yellow-200/50">LOAD AMPERAGE</p>
                <p className="text-xs font-bold text-yellow-400">A</p>
              </div>
            </CardContent></Card>
          </div>

          <div className="animate-fadeInUp" style={{ animationDelay: '0.3s' }}>
            <Card className="glass-card hover:scale-[1.02] transition-transform duration-300"><CardContent className="p-5">
              <div className="flex items-center justify-between">
                <div><p className="text-xs font-mono text-purple-200/70 tracking-widest uppercase">Power</p>
                  <p className="text-3xl font-black mt-1 text-white neon-text-purple">{live?.power !== undefined ? (live.power/1000).toFixed(2) : '—'}</p>
                </div>
                <div className="rounded-xl bg-purple-950/50 border border-purple-500/30 p-3"><Zap className="h-6 w-6 text-purple-400" /></div>
              </div>
              <div className="mt-3 flex items-center justify-between">
                <p className="text-[10px] font-mono text-purple-200/50">ACTIVE LOAD</p>
                <p className="text-xs font-bold text-purple-400">kW</p>
              </div>
            </CardContent></Card>
          </div>

          <div className="animate-fadeInUp" style={{ animationDelay: '0.4s' }}>
            <Card className="glass-card hover:scale-[1.02] transition-transform duration-300"><CardContent className="p-5">
              <div className="flex items-center justify-between">
                <div><p className="text-xs font-mono text-red-200/70 tracking-widest uppercase">Core Temp</p>
                  <p className="text-3xl font-black mt-1 text-white neon-text-red">{live?.temperature !== undefined ? live.temperature.toFixed(1) : '—'}</p>
                </div>
                <div className="rounded-xl bg-red-950/50 border border-red-500/30 p-3"><Thermometer className="h-6 w-6 text-red-400" /></div>
              </div>
              <div className="mt-3 flex items-center justify-between">
                <p className="text-[10px] font-mono text-red-200/50">SYSTEM HEAT</p>
                <p className="text-xs font-bold text-red-400">°C</p>
              </div>
            </CardContent></Card>
          </div>

        </div>

        {/* BILLING PANEL */}
        <div className="mb-8 animate-fadeInUp" style={{ animationDelay: '0.5s' }}>
          <Card className="glass-card border-emerald-500/20 shadow-[0_0_30px_rgba(16,185,129,0.05)]">
            <CardContent className="p-5">
              <div className="flex flex-wrap items-center gap-6 md:gap-10">

                {/* Section label */}
                <div className="flex items-center gap-2 min-w-fit">
                  <div className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
                  <span className="text-xs font-mono text-emerald-400/80 tracking-widest uppercase">Monthly Billing</span>
                  <span className="text-[10px] font-mono text-emerald-400/40 ml-1">CEB D1 · APR 2026</span>
                </div>

                {/* Monthly kWh */}
                <div className="flex items-center gap-3">
                  <div className="rounded-xl bg-emerald-950/50 border border-emerald-500/30 p-2.5">
                    <Zap className="h-5 w-5 text-emerald-400" />
                  </div>
                  <div>
                    <p className="text-[10px] font-mono text-emerald-200/50 tracking-widest uppercase">Units This Month</p>
                    <p className="text-2xl font-black text-white mt-0.5">
                      {live?.monthly_kwh !== undefined ? live.monthly_kwh.toFixed(3) : '—'}
                      <span className="text-sm font-mono text-emerald-400 ml-1.5">kWh</span>
                    </p>
                  </div>
                </div>

                {/* Estimated Bill */}
                <div className="flex items-center gap-3">
                  <div className="rounded-xl bg-amber-950/50 border border-amber-500/30 p-2.5">
                    <Receipt className="h-5 w-5 text-amber-400" />
                  </div>
                  <div>
                    <p className="text-[10px] font-mono text-amber-200/50 tracking-widest uppercase">Estimated Bill</p>
                    <p className="text-2xl font-black text-white mt-0.5">
                      {live?.monthly_bill_lkr !== undefined
                        ? `Rs. ${live.monthly_bill_lkr.toFixed(2)}`
                        : '—'}
                      <span className="text-[10px] font-mono text-amber-400/60 ml-1.5">LKR</span>
                    </p>
                  </div>
                </div>

                {/* Reset button */}
                <div className="ml-auto shrink-0">
                  <button
                    id="billing-reset-btn"
                    onClick={() => setShowResetDialog(true)}
                    className="flex items-center gap-2 rounded-lg border border-red-500/30 bg-red-950/20 px-4 py-2 text-xs font-mono text-red-400 tracking-wider transition-all hover:bg-red-900/40 hover:border-red-400/50 hover:shadow-[0_0_20px_rgba(239,68,68,0.25)] active:scale-95"
                  >
                    <RotateCcw className="h-3.5 w-3.5" />
                    RESET BILLING
                  </button>
                </div>

              </div>
            </CardContent>
          </Card>
        </div>

        {/* SEPARATE PARAMETER CHARTS */}
        <div className="mb-8 grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          
          {/* Voltage Chart */}
          <div className="animate-fadeInUp" style={{ animationDelay: '0.2s' }}>
            <Card className="glass-card h-full">
              <CardHeader className="pb-2 border-b border-cyan-500/10">
                <CardTitle className="text-sm font-mono tracking-widest text-cyan-400 flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-cyan-400 animate-pulse"></div> VOLTAGE LOG
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-4">
                <div className="h-48">
                  {electricalHistory.length === 0 ? <LoaderPlaceholder /> : (
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={electricalHistory}>
                        <defs>
                          <linearGradient id="colorVoltage" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#22d3ee" stopOpacity={0.5}/>
                            <stop offset="95%" stopColor="#22d3ee" stopOpacity={0}/>
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#1f2937" />
                        <XAxis dataKey="time" hide />
                        <YAxis domain={[180, 260]} tick={{ fill: '#4b5563', fontSize: 10 }} stroke="#374151" />
                        <Tooltip contentStyle={{ backgroundColor: '#111827', borderColor: '#22d3ee', color: '#fff' }} itemStyle={{ color: '#22d3ee' }} />
                        <Area type="monotone" dataKey="voltage" stroke="#22d3ee" strokeWidth={2} fillOpacity={1} fill="url(#colorVoltage)" />
                      </AreaChart>
                    </ResponsiveContainer>
                  )}
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Current Chart */}
          <div className="animate-fadeInUp" style={{ animationDelay: '0.3s' }}>
            <Card className="glass-card h-full">
              <CardHeader className="pb-2 border-b border-yellow-500/10">
                <CardTitle className="text-sm font-mono tracking-widest text-yellow-400 flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-yellow-400 animate-pulse"></div> CURRENT LOG
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-4">
                <div className="h-48">
                  {electricalHistory.length === 0 ? <LoaderPlaceholder /> : (
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={electricalHistory}>
                        <defs>
                          <linearGradient id="colorCurrent" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#facc15" stopOpacity={0.5}/>
                            <stop offset="95%" stopColor="#facc15" stopOpacity={0}/>
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#1f2937" />
                        <XAxis dataKey="time" hide />
                        <YAxis tick={{ fill: '#4b5563', fontSize: 10 }} stroke="#374151" />
                        <Tooltip contentStyle={{ backgroundColor: '#111827', borderColor: '#facc15', color: '#fff' }} itemStyle={{ color: '#facc15' }} />
                        <Area type="monotone" dataKey="current" stroke="#facc15" strokeWidth={2} fillOpacity={1} fill="url(#colorCurrent)" />
                      </AreaChart>
                    </ResponsiveContainer>
                  )}
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Power Chart */}
          <div className="animate-fadeInUp" style={{ animationDelay: '0.4s' }}>
            <Card className="glass-card h-full">
              <CardHeader className="pb-2 border-b border-purple-500/10">
                <CardTitle className="text-sm font-mono tracking-widest text-purple-400 flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-purple-400 animate-pulse"></div> POWER LOG
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-4">
                <div className="h-48">
                  {electricalHistory.length === 0 ? <LoaderPlaceholder /> : (
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={electricalHistory}>
                        <defs>
                          <linearGradient id="colorPower" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#c084fc" stopOpacity={0.5}/>
                            <stop offset="95%" stopColor="#c084fc" stopOpacity={0}/>
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#1f2937" />
                        <XAxis dataKey="time" hide />
                        <YAxis tickFormatter={(v) => (v/1000).toFixed(1)} tick={{ fill: '#4b5563', fontSize: 10 }} stroke="#374151" />
                        <Tooltip formatter={(v: any) => [`${(v/1000).toFixed(2)} kW`, 'Power']} contentStyle={{ backgroundColor: '#111827', borderColor: '#c084fc', color: '#fff' }} itemStyle={{ color: '#c084fc' }} />
                        <Area type="monotone" dataKey="power" stroke="#c084fc" strokeWidth={2} fillOpacity={1} fill="url(#colorPower)" />
                      </AreaChart>
                    </ResponsiveContainer>
                  )}
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Temperature Chart */}
          <div className="animate-fadeInUp" style={{ animationDelay: '0.5s' }}>
            <Card className="glass-card h-full">
              <CardHeader className="pb-2 border-b border-red-500/10">
                <CardTitle className="text-sm font-mono tracking-widest text-red-400 flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-red-400 animate-pulse"></div> THERMAL LOG
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-4">
                <div className="h-48">
                  {tempHistory.length === 0 ? <LoaderPlaceholder /> : (
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={tempHistory}>
                        <defs>
                          <linearGradient id="colorTemp" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#f87171" stopOpacity={0.5}/>
                            <stop offset="95%" stopColor="#f87171" stopOpacity={0}/>
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#1f2937" />
                        <XAxis dataKey="time" hide />
                        <YAxis domain={[0, 100]} tick={{ fill: '#4b5563', fontSize: 10 }} stroke="#374151" />
                        <Tooltip contentStyle={{ backgroundColor: '#111827', borderColor: '#f87171', color: '#fff' }} itemStyle={{ color: '#f87171' }} />
                        <Area type="monotone" dataKey="temperature" stroke="#f87171" strokeWidth={2} fillOpacity={1} fill="url(#colorTemp)" />
                      </AreaChart>
                    </ResponsiveContainer>
                  )}
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Fault Distribution */}
          <div className="animate-fadeInUp" style={{ animationDelay: '0.6s' }}>
            <Card className="glass-card h-full">
              <CardHeader className="pb-2 border-b border-orange-500/10">
                <CardTitle className="text-sm font-mono tracking-widest text-orange-400 flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-orange-400 animate-pulse"></div> FAULT VECTORS
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-4">
                <div className="h-48">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie data={faultData} cx="50%" cy="50%" outerRadius={60} dataKey="value" stroke="rgba(17,24,39,0.8)" strokeWidth={2}>
                        {faultData.map((e, i) => <Cell key={i} fill={e.color} />)}
                      </Pie>
                      <Tooltip contentStyle={{ backgroundColor: '#111827', borderColor: '#fb923c', color: '#fff' }} />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                <div className="mt-2 text-center">
                  <p className="text-xs text-orange-200/50 font-mono">TOTAL FAULTS: <span className="text-orange-400 font-bold">{totalFaults}</span></p>
                </div>
              </CardContent>
            </Card>
          </div>

        </div>

        {/* ALERT & DATA FLOW BOX (UNFOLDABLE) */}
        {isFlowTableOpen && (
          <div className="mb-8 animate-fadeInUp">
            <Card className="glass-card border-cyan-500/30 overflow-hidden">
              <CardHeader className="bg-[#111827]/80 py-4 border-b border-cyan-500/20 relative overflow-hidden">
                <div className="absolute top-0 left-0 w-full h-[1px] bg-gradient-to-r from-transparent via-cyan-500 to-transparent"></div>
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                  <div>
                    <CardTitle className="text-lg flex items-center gap-3 text-cyan-300 font-mono">
                      <Activity className="h-5 w-5 text-cyan-400 animate-pulse" />
                      DATA STREAM LOG
                    </CardTitle>
                    <CardDescription className="text-cyan-200/50 font-mono text-xs mt-1">REAL-TIME TELEMETRY & ALERTS</CardDescription>
                  </div>
                  
                  <div className="flex items-center gap-2 bg-[#0B1120]/80 p-1 rounded border border-cyan-500/20 backdrop-blur-sm">
                    <Button 
                      variant="ghost" 
                      size="sm" 
                      onClick={() => setFlowView('alerts')}
                      className={`h-8 rounded-sm font-mono text-xs transition-colors ${flowView === 'alerts' ? 'bg-cyan-900/60 text-cyan-300 shadow-[0_0_10px_rgba(0,255,255,0.2)]' : 'text-gray-400 hover:text-cyan-100 hover:bg-white/5'}`}
                    >
                      ALERTS [{alertHistory.length}]
                    </Button>
                    <Button 
                      variant="ghost" 
                      size="sm" 
                      onClick={() => setFlowView('data')}
                      className={`h-8 rounded-sm font-mono text-xs transition-colors ${flowView === 'data' ? 'bg-cyan-900/60 text-cyan-300 shadow-[0_0_10px_rgba(0,255,255,0.2)]' : 'text-gray-400 hover:text-cyan-100 hover:bg-white/5'}`}
                    >
                      DATA FLOW
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="p-0 bg-[#0B1120]/60 backdrop-blur-md">
                <div className="max-h-[400px] overflow-y-auto custom-scrollbar">
                  {flowView === 'alerts' ? (
                    <table className="w-full text-left text-sm font-mono">
                      <thead className="bg-[#111827]/90 sticky top-0 z-10 border-b border-cyan-500/20 shadow-md">
                        <tr>
                          <th className="px-5 py-3 text-cyan-400/80 font-semibold text-xs tracking-wider">TIMESTAMP</th>
                          <th className="px-5 py-3 text-cyan-400/80 font-semibold text-xs tracking-wider">STATUS</th>
                          <th className="px-5 py-3 text-cyan-400/80 font-semibold text-xs tracking-wider">MESSAGE</th>
                        </tr>
                      </thead>
                      <tbody>
                        {alertHistory.length === 0 ? (
                          <tr>
                            <td colSpan={3} className="px-5 py-12 text-center text-cyan-200/40 italic">NO ANOMALIES DETECTED. SYSTEM NORMAL.</td>
                          </tr>
                        ) : (
                          alertHistory.map((alert) => (
                            <tr key={alert.id} className="border-b border-cyan-500/10 hover:bg-cyan-900/20 transition-colors group">
                              <td className="px-5 py-3 text-cyan-200/60 whitespace-nowrap text-xs group-hover:text-cyan-300 transition-colors">{alert.time}</td>
                              <td className="px-5 py-3">
                                <Badge variant="outline" className={
                                  alert.type === 'critical' ? 'bg-red-950/50 text-red-400 border-red-500/50 shadow-[0_0_10px_rgba(239,68,68,0.2)]' :
                                  alert.type === 'warning'  ? 'bg-yellow-950/50 text-yellow-400 border-yellow-500/50 shadow-[0_0_10px_rgba(234,179,8,0.2)]' :
                                                             'bg-cyan-950/50 text-cyan-400 border-cyan-500/50 shadow-[0_0_10px_rgba(0,255,255,0.2)]'
                                }>
                                  {alert.type.toUpperCase()}
                                </Badge>
                              </td>
                              <td className="px-5 py-3 text-white text-sm group-hover:text-cyan-100 transition-colors">
                                <span className="font-semibold">{alert.title}</span>: <span className="opacity-80">{alert.message}</span>
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  ) : (
                    <table className="w-full text-left text-sm font-mono">
                      <thead className="bg-[#111827]/90 sticky top-0 z-10 border-b border-cyan-500/20 shadow-md">
                        <tr>
                          <th className="px-5 py-3 text-cyan-400/80 font-semibold text-xs tracking-wider">TIMESTAMP</th>
                          <th className="px-5 py-3 text-cyan-400 font-semibold text-xs tracking-wider">VOLT</th>
                          <th className="px-5 py-3 text-yellow-400 font-semibold text-xs tracking-wider">AMP</th>
                          <th className="px-5 py-3 text-red-400 font-semibold text-xs tracking-wider">TEMP</th>
                          <th className="px-5 py-3 text-purple-400 font-semibold text-xs tracking-wider">PWR</th>
                        </tr>
                      </thead>
                      <tbody>
                        {measurementHistory.length === 0 ? (
                          <tr>
                            <td colSpan={5} className="px-5 py-12 text-center text-cyan-200/40 italic">AWAITING TELEMETRY SYNC...</td>
                          </tr>
                        ) : (
                          measurementHistory.map((m) => (
                            <tr key={m.id} className="border-b border-cyan-500/10 hover:bg-cyan-900/20 transition-colors group">
                              <td className="px-5 py-3 text-cyan-200/50 whitespace-nowrap text-xs group-hover:text-cyan-300 transition-colors">{m.time}</td>
                              <td className="px-5 py-3 font-semibold text-cyan-300 group-hover:text-cyan-100 transition-colors">{m.voltage !== undefined ? m.voltage.toFixed(1) : '-'}</td>
                              <td className="px-5 py-3 font-semibold text-yellow-300 group-hover:text-yellow-100 transition-colors">{m.current !== undefined ? m.current.toFixed(2) : '-'}</td>
                              <td className="px-5 py-3 font-semibold text-red-300 group-hover:text-red-100 transition-colors">{m.temperature !== undefined ? m.temperature.toFixed(1) : '-'}</td>
                              <td className="px-5 py-3 font-semibold text-purple-300 group-hover:text-purple-100 transition-colors">{m.power !== undefined ? m.power.toFixed(0) : '-'}</td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  )}
                </div>
                <div className="p-3 bg-[#111827]/80 flex justify-between items-center border-t border-cyan-500/20">
                  <span className="text-[10px] font-mono text-cyan-200/50 tracking-widest">DISPLAYING LAST 50 VECTORS</span>
                  <Button 
                    variant="ghost" 
                    size="sm" 
                    className="h-7 text-xs font-mono text-red-400 hover:text-red-300 hover:bg-red-900/30 transition-colors border border-transparent hover:border-red-500/30"
                    onClick={() => flowView === 'alerts' ? setAlertHistory([]) : setMeasurementHistory([])}
                  >
                    PURGE {flowView === 'alerts' ? 'ALERTS' : 'DATA'}
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>
        )}

      </main>

      {/* BILLING RESET CONFIRMATION DIALOG */}
      {showResetDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" id="billing-reset-dialog">
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-[#0B1120]/80 backdrop-blur-sm"
            onClick={() => !isResetting && setShowResetDialog(false)}
          />
          {/* Modal panel */}
          <div className="relative w-full max-w-md rounded-xl border border-red-500/40 bg-[#111827]/95 backdrop-blur-xl p-6 shadow-[0_0_60px_rgba(239,68,68,0.15)] animate-fadeIn">
            {/* Header */}
            <div className="mb-5 flex items-center gap-3">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-red-950/60 border border-red-500/40">
                <RotateCcw className="h-5 w-5 text-red-400" />
              </div>
              <div>
                <h2 className="text-base font-bold text-white font-mono tracking-wide">RESET BILLING UNITS?</h2>
                <p className="text-[10px] text-red-300/50 font-mono mt-0.5">DEVICE: {deviceId}</p>
              </div>
            </div>
            {/* Body */}
            <p className="mb-3 text-sm text-slate-300 leading-relaxed">
              This will <span className="text-red-400 font-semibold">zero out</span> the monthly kWh counter and estimated bill stored on the ESP32 NVS flash. The command is delivered on the next sensor upload (within 1 second).
            </p>
            <p className="mb-6 text-xs font-mono text-amber-400/70 bg-amber-950/20 border border-amber-500/20 rounded-md px-3 py-2">
              ⚠ Identical to pressing the physical GPIO 32 button — 3 beeps confirm on device. Use at the start of each billing month.
            </p>
            {/* Actions */}
            <div className="flex gap-3">
              <button
                id="billing-reset-confirm"
                onClick={handleResetBilling}
                disabled={isResetting}
                className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-red-600 px-4 py-2.5 text-sm font-mono font-bold text-white transition-all hover:bg-red-500 hover:shadow-[0_0_20px_rgba(239,68,68,0.4)] disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isResetting
                  ? <><Loader2 className="h-4 w-4 animate-spin" /> SENDING...</>
                  : <><RotateCcw className="h-4 w-4" /> CONFIRM RESET</>
                }
              </button>
              <button
                id="billing-reset-cancel"
                onClick={() => setShowResetDialog(false)}
                disabled={isResetting}
                className="rounded-lg border border-slate-600/40 bg-slate-800/40 px-4 py-2.5 text-sm font-mono text-slate-400 transition-all hover:border-slate-500/60 hover:text-slate-200 disabled:opacity-50"
              >
                CANCEL
              </button>
            </div>
          </div>
        </div>
      )}

      <style jsx global>{`
        /* Custom scrollbar for main area */
        .custom-scrollbar::-webkit-scrollbar {
          width: 8px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
          background: rgba(11, 17, 32, 0.8);
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background: rgba(0, 255, 255, 0.3);
          border-radius: 4px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover {
          background: rgba(0, 255, 255, 0.5);
        }
        
        @keyframes fadeInDown {
          from { opacity: 0; transform: translateY(-30px); }
          to { opacity: 1; transform: translateY(0); }
        }
        
        @keyframes fadeInUp {
          from { opacity: 0; transform: translateY(30px); }
          to { opacity: 1; transform: translateY(0); }
        }
        
        @keyframes slideInLeft {
          from { opacity: 0; transform: translateX(-30px); }
          to { opacity: 1; transform: translateX(0); }
        }
        
        .animate-fadeInDown {
          animation: fadeInDown 0.6s cubic-bezier(0.16, 1, 0.3, 1) forwards;
        }
        
        .animate-fadeInUp {
          animation: fadeInUp 0.6s cubic-bezier(0.16, 1, 0.3, 1) forwards;
          opacity: 0;
        }
        
        .animate-slideInLeft {
          animation: slideInLeft 0.5s cubic-bezier(0.16, 1, 0.3, 1) forwards;
        }
      `}</style>
    </div>
  )
}

function LoaderPlaceholder() {
  return (
    <div className="flex h-full items-center justify-center text-cyan-500/50 font-mono text-sm tracking-widest">
      <Loader2 className="mr-3 h-5 w-5 animate-spin" /> ACQUIRING DATA...
    </div>
  )
}