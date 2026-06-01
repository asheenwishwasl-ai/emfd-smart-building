"use client"

import { useState, useEffect } from 'react'
import { Building2, Calendar, Download, TrendingUp, Thermometer, Droplets, Zap, AlertTriangle, Home, Loader2, Wifi, Activity, LogOut } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, AreaChart, Area } from 'recharts'
import Link from 'next/link'
import { NotificationBell } from '@/components/notification-bell'
import { signOut, useSession } from 'next-auth/react'
import { useTheme } from 'next-themes'

const DEVICE_ID = process.env.NEXT_PUBLIC_DEVICE_ID || 'building-01'

export default function HistoricalPage() {
  const { theme, setTheme } = useTheme()
  const { data: session } = useSession()
  const [mounted, setMounted]       = useState(false)
  const [deviceId, setDeviceId]     = useState(process.env.NEXT_PUBLIC_DEVICE_ID || 'building-01')
  const [devices, setDevices]       = useState<string[]>([])
  const [timeRange, setTimeRange]   = useState('7days')
  const [historicalData, setHistoricalData] = useState<any[]>([])
  const [loading, setLoading]       = useState(false)

  useEffect(() => { 
    setMounted(true)
    setTheme('dark')
  }, [setTheme])

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
  }, [])

  useEffect(() => {
    if (!mounted) return
    setLoading(true)
    fetch(`/api/history?device_id=${deviceId}&range=${timeRange}`)
      .then(r => r.json())
      .then(json => {
        setHistoricalData(json.data || [])
      })
      .catch(() => setHistoricalData([]))
      .finally(() => setLoading(false))
  }, [timeRange, deviceId, mounted])

  const totalFaults = historicalData.reduce((s, d) => s + (d.faults || 0), 0)
  const avgTemp     = historicalData.reduce((s, d) => s + (d.temperature || 0), 0) / (historicalData.length || 1)
  const avgPower    = historicalData.reduce((s, d) => s + (d.power || 0), 0) / (historicalData.length || 1)

  const exportToCSV = () => {
    const headers = ['Date','Power (W)','Temperature (°C)','Voltage (V)','Current (A)','Faults']
    const rows = historicalData.map(d => [d.fullDate, Math.round(d.power), d.temperature?.toFixed(1), d.voltage?.toFixed(1), d.current?.toFixed(2), d.faults])
    const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n')
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }))
    a.download = `emfd-history-${timeRange}.csv`
    a.click()
  }

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
          <Link href="/dashboard" className="flex items-center gap-4 p-3 rounded-lg hover:bg-white/10 text-gray-400 hover:text-cyan-100 transition-all">
            <Home className="h-5 w-5 shrink-0" />
            <span className="whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity font-medium tracking-wide">Dashboard</span>
          </Link>
          <Link href="/historical" className="flex items-center gap-4 p-3 rounded-lg bg-cyan-900/40 border border-cyan-500/50 text-cyan-300 transition-all shadow-[0_0_15px_rgba(0,255,255,0.2)]">
            <Calendar className="h-5 w-5 shrink-0" />
            <span className="whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity tracking-wide">Historical Data</span>
          </Link>
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
        
        {/* Header */}
        <div className="mb-8 flex flex-wrap items-center justify-between gap-4 animate-fadeInDown">
          <div>
            <h1 className="text-3xl font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 to-blue-600 drop-shadow-[0_0_10px_rgba(0,255,255,0.3)] uppercase tracking-wider">
              Historical Analysis
            </h1>
            {session?.user?.email && <p className="text-sm text-cyan-200/60 font-mono mt-1">OPERATOR: {session.user.email}</p>}
          </div>
          
          <div className="flex items-center gap-4 flex-wrap">
            <NotificationBell />

            {/* Device Dropdown Selector */}
            <div className="flex items-center gap-2 bg-[#111827]/60 border border-cyan-500/20 px-3 py-2 rounded-md backdrop-blur-sm shadow-[0_0_15px_rgba(0,255,255,0.02)]">
              <span className="text-xs font-mono text-cyan-200/50 uppercase tracking-wider">UNIT:</span>
              <select
                value={deviceId}
                onChange={(e) => setDeviceId(e.target.value)}
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
            <div className="flex bg-[#111827]/60 border border-cyan-500/30 rounded-lg p-1 backdrop-blur-sm">
              {['7days','30days','90days'].map(r => (
                <Button 
                  key={r} 
                  variant="ghost"
                  size="sm" 
                  onClick={() => setTimeRange(r)}
                  className={`h-8 px-4 rounded-md font-mono text-xs transition-colors ${timeRange === r ? 'bg-cyan-900/60 text-cyan-300 shadow-[0_0_10px_rgba(0,255,255,0.2)]' : 'text-gray-400 hover:text-cyan-100 hover:bg-white/5'}`}
                >
                  {r === '7days' ? '7 DAYS' : r === '30days' ? '30 DAYS' : '90 DAYS'}
                </Button>
              ))}
            </div>
            <Button variant="outline" size="sm" className="gap-2 bg-cyan-950/30 border-cyan-500/50 text-cyan-400 hover:bg-cyan-900/50 hover:text-cyan-300 font-mono shadow-[0_0_10px_rgba(0,255,255,0.1)]" onClick={exportToCSV}>
              <Download className="h-4 w-4" /> EXPORT CSV
            </Button>
          </div>
        </div>

        {loading && (
          <div className="mb-6 flex items-center gap-3 text-cyan-500/50 font-mono text-sm tracking-widest bg-[#111827]/60 w-fit px-4 py-2 rounded-lg border border-cyan-500/20 backdrop-blur-sm">
            <Loader2 className="h-5 w-5 animate-spin" /> ACQUIRING HISTORICAL DATA ARCHIVE...
          </div>
        )}

        {/* Summary Cards */}
        <div className="mb-8 grid gap-5 md:grid-cols-2 lg:grid-cols-3">
          {[
            { label: 'Total Faults', value: totalFaults, unit: '', icon: AlertTriangle, color: 'orange', sub: `OVER ${timeRange.toUpperCase()}`, neon: 'neon-text-yellow' },
            { label: 'Avg Temperature', value: avgTemp.toFixed(1), unit: '°C', icon: Thermometer, color: 'red', sub: 'DAILY AVERAGE', neon: 'neon-text-red' },
            { label: 'Avg Power', value: (avgPower/1000).toFixed(1), unit: ' kW', icon: Zap, color: 'purple', sub: 'DAILY AVERAGE', neon: 'neon-text-purple' },
          ].map(({ label, value, unit, icon: Icon, color, sub, neon }, index) => (
            <div key={label} className="animate-fadeInUp" style={{ animationDelay: `${0.1 + index * 0.1}s` }}>
              <Card className="glass-card hover:scale-[1.02] transition-transform duration-300"><CardContent className="p-5">
              <div className="flex items-center justify-between">
                <div><p className="text-xs font-mono text-gray-400 tracking-widest uppercase">{label}</p>
                  <p className={`text-3xl font-black mt-1 text-white ${neon}`}>{value}<span className="text-xl ml-1">{unit}</span></p>
                </div>
                <div className={`rounded-xl bg-${color}-950/50 border border-${color}-500/30 p-3`}>
                  <Icon className={`h-6 w-6 text-${color}-400`} />
                </div>
              </div>
              <p className="mt-3 text-[10px] font-mono text-gray-500 tracking-widest">{sub}</p>
            </CardContent></Card>
            </div>
          ))}
        </div>

        {/* SEPARATE HISTORICAL CHARTS */}
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3 mb-8">
          
          {/* Voltage Trend */}
          <div className="animate-fadeInUp" style={{ animationDelay: '0.1s' }}>
            <Card className="glass-card h-full">
              <CardHeader className="pb-2 border-b border-cyan-500/10">
                <CardTitle className="text-sm font-mono tracking-widest text-cyan-400 flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-cyan-400 animate-pulse"></div> VOLTAGE TREND
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-4">
                <div className="h-48">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={historicalData}>
                      <defs>
                        <linearGradient id="colorVoltHist" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#22d3ee" stopOpacity={0.5}/>
                          <stop offset="95%" stopColor="#22d3ee" stopOpacity={0}/>
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#1f2937" />
                      <XAxis dataKey="date" hide />
                      <YAxis domain={[180, 260]} tick={{ fill: '#4b5563', fontSize: 10 }} stroke="#374151" />
                      <Tooltip contentStyle={{ backgroundColor: '#111827', borderColor: '#22d3ee', color: '#fff' }} itemStyle={{ color: '#22d3ee' }} />
                      <Area type="monotone" dataKey="voltage" stroke="#22d3ee" strokeWidth={2} fillOpacity={1} fill="url(#colorVoltHist)" />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Current Trend */}
          <div className="animate-fadeInUp" style={{ animationDelay: '0.2s' }}>
            <Card className="glass-card h-full">
              <CardHeader className="pb-2 border-b border-yellow-500/10">
                <CardTitle className="text-sm font-mono tracking-widest text-yellow-400 flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-yellow-400 animate-pulse"></div> CURRENT TREND
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-4">
                <div className="h-48">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={historicalData}>
                      <defs>
                        <linearGradient id="colorCurrHist" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#facc15" stopOpacity={0.5}/>
                          <stop offset="95%" stopColor="#facc15" stopOpacity={0}/>
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#1f2937" />
                      <XAxis dataKey="date" hide />
                      <YAxis tick={{ fill: '#4b5563', fontSize: 10 }} stroke="#374151" />
                      <Tooltip contentStyle={{ backgroundColor: '#111827', borderColor: '#facc15', color: '#fff' }} itemStyle={{ color: '#facc15' }} />
                      <Area type="monotone" dataKey="current" stroke="#facc15" strokeWidth={2} fillOpacity={1} fill="url(#colorCurrHist)" />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Power Trend */}
          <div className="animate-fadeInUp" style={{ animationDelay: '0.3s' }}>
            <Card className="glass-card h-full">
              <CardHeader className="pb-2 border-b border-purple-500/10">
                <CardTitle className="text-sm font-mono tracking-widest text-purple-400 flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-purple-400 animate-pulse"></div> POWER TREND
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-4">
                <div className="h-48">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={historicalData}>
                      <defs>
                        <linearGradient id="colorPwrHist" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#c084fc" stopOpacity={0.5}/>
                          <stop offset="95%" stopColor="#c084fc" stopOpacity={0}/>
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#1f2937" />
                      <XAxis dataKey="date" hide />
                      <YAxis tickFormatter={(v) => (v/1000).toFixed(1)} tick={{ fill: '#4b5563', fontSize: 10 }} stroke="#374151" />
                      <Tooltip formatter={(v: any) => [`${(v/1000).toFixed(2)} kW`, 'Power']} contentStyle={{ backgroundColor: '#111827', borderColor: '#c084fc', color: '#fff' }} itemStyle={{ color: '#c084fc' }} />
                      <Area type="monotone" dataKey="power" stroke="#c084fc" strokeWidth={2} fillOpacity={1} fill="url(#colorPwrHist)" />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Temperature Trend */}
          <div className="animate-fadeInUp" style={{ animationDelay: '0.4s' }}>
            <Card className="glass-card h-full">
              <CardHeader className="pb-2 border-b border-red-500/10">
                <CardTitle className="text-sm font-mono tracking-widest text-red-400 flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-red-400 animate-pulse"></div> THERMAL TREND
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-4">
                <div className="h-48">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={historicalData}>
                      <defs>
                        <linearGradient id="colorTempHist" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#f87171" stopOpacity={0.5}/>
                          <stop offset="95%" stopColor="#f87171" stopOpacity={0}/>
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#1f2937" />
                      <XAxis dataKey="date" hide />
                      <YAxis domain={[0, 100]} tick={{ fill: '#4b5563', fontSize: 10 }} stroke="#374151" />
                      <Tooltip contentStyle={{ backgroundColor: '#111827', borderColor: '#f87171', color: '#fff' }} itemStyle={{ color: '#f87171' }} />
                      <Area type="monotone" dataKey="temperature" stroke="#f87171" strokeWidth={2} fillOpacity={1} fill="url(#colorTempHist)" />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Daily Faults */}
          <div className="animate-fadeInUp" style={{ animationDelay: '0.5s' }}>
            <Card className="glass-card h-full">
              <CardHeader className="pb-2 border-b border-orange-500/10">
                <CardTitle className="text-sm font-mono tracking-widest text-orange-400 flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-orange-400 animate-pulse"></div> DAILY FAULT LOG
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-4">
                <div className="h-48">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={historicalData}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#1f2937" />
                      <XAxis dataKey="date" hide />
                      <YAxis tick={{ fill: '#4b5563', fontSize: 10 }} stroke="#374151" />
                      <Tooltip contentStyle={{ backgroundColor: '#111827', borderColor: '#fb923c', color: '#fff' }} cursor={{ fill: 'rgba(255,255,255,0.05)' }} />
                      <Bar dataKey="faults" fill="#fb923c" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>
          </div>

        </div>

        <div className="animate-fadeInUp mb-8" style={{ animationDelay: '0.6s' }}>
          <Card className="glass-card border-cyan-500/30 overflow-hidden">
            <CardHeader className="bg-[#111827]/80 py-4 border-b border-cyan-500/20 relative overflow-hidden">
              <div className="absolute top-0 left-0 w-full h-[1px] bg-gradient-to-r from-transparent via-cyan-500 to-transparent"></div>
              <CardTitle className="text-lg flex items-center gap-3 text-cyan-300 font-mono">
                <Calendar className="h-5 w-5 text-cyan-400" />
                ARCHIVE DATA MATRIX
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0 bg-[#0B1120]/60 backdrop-blur-md">
              <div className="overflow-x-auto custom-scrollbar max-h-[400px]">
                <table className="w-full text-sm font-mono text-left">
                  <thead className="bg-[#111827]/90 sticky top-0 z-10 border-b border-cyan-500/20 shadow-md">
                    <tr>
                      {['DATE','PWR (kW)','TEMP (°C)','VOLT (V)','FAULTS'].map((h, i) => (
                        <th key={h} className={`px-5 py-3 font-semibold text-xs tracking-wider ${
                          i===0 ? 'text-cyan-400/80' : 
                          i===1 ? 'text-purple-400' : 
                          i===2 ? 'text-red-400' : 
                          i===3 ? 'text-cyan-400' : 'text-orange-400'
                        }`}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {historicalData.slice(-10).map((day, i) => (
                      <tr key={i} className="border-b border-cyan-500/10 hover:bg-cyan-900/20 transition-colors group">
                        <td className="px-5 py-3 text-cyan-200/50 whitespace-nowrap text-xs group-hover:text-cyan-300 transition-colors">{day.date}</td>
                        <td className="px-5 py-3 font-semibold text-purple-300 group-hover:text-purple-100 transition-colors">{(day.power/1000).toFixed(1)}</td>
                        <td className="px-5 py-3 font-semibold text-red-300 group-hover:text-red-100 transition-colors">{day.temperature?.toFixed(1)}</td>
                        <td className="px-5 py-3 font-semibold text-cyan-300 group-hover:text-cyan-100 transition-colors">{day.voltage?.toFixed(0)}</td>
                        <td className="px-5 py-3 font-semibold text-orange-300 group-hover:text-orange-100 transition-colors">{day.faults}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </div>

      </main>
      
      <style jsx global>{`
        /* Reused custom scrollbar for main area */
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
        
        .animate-fadeInDown {
          animation: fadeInDown 0.6s cubic-bezier(0.16, 1, 0.3, 1) forwards;
        }
        
        .animate-fadeInUp {
          animation: fadeInUp 0.6s cubic-bezier(0.16, 1, 0.3, 1) forwards;
          opacity: 0;
        }
      `}</style>
    </div>
  )
}
