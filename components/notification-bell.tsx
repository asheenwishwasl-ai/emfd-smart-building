"use client"

import { useState, useEffect, useRef } from 'react'
import { Bell, AlertTriangle, Thermometer, Zap, Flame, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Badge } from '@/components/ui/badge'

interface Notification {
  id: string
  title: string
  message: string
  time: string
  type: 'critical' | 'warning' | 'info'
  read: boolean
}

interface SensorReading {
  temperature: number
  voltage: number
  current: number
  flame: number
  device_id?: string
  _demo?: boolean
}

interface Props {
  liveData?: SensorReading | null
}

export function NotificationBell({ liveData }: Props) {
  const [notifications, setNotifications] = useState<Notification[]>([])
  const [open, setOpen] = useState(false)
  const prevData = useRef<SensorReading | null>(null)

  const addNotification = (title: string, message: string, type: 'critical' | 'warning' | 'info') => {
    setNotifications(prev => [
      {
        id:      Date.now().toString(),
        title,
        message,
        time:    new Date().toLocaleTimeString(),
        type,
        read:    false,
      },
      ...prev,
    ].slice(0, 20))
  }

  // Generate real alerts from live sensor data
  useEffect(() => {
    if (!liveData) return
    const prev = prevData.current

    // Flame detection
    if (liveData.flame === 1 && (!prev || prev.flame === 0)) {
      addNotification('🔥 Flame Detected!', `CRITICAL: Flame sensor triggered on ${liveData.device_id || 'device'}`, 'critical')
    }

    // Temperature
    if (liveData.temperature > 55 && (!prev || prev.temperature <= 55)) {
      addNotification('🌡️ Critical Temperature', `Temperature reached ${liveData.temperature.toFixed(1)}°C – above safe limit`, 'critical')
    } else if (liveData.temperature > 45 && (!prev || prev.temperature <= 45)) {
      addNotification('⚠️ High Temperature', `Temperature is ${liveData.temperature.toFixed(1)}°C – approaching limit`, 'warning')
    }


    // Voltage
    if (liveData.voltage < 195 && (!prev || prev.voltage >= 195)) {
      addNotification('⚡ Undervoltage', `Voltage dropped to ${liveData.voltage.toFixed(0)}V`, 'critical')
    }
    if (liveData.voltage > 250 && (!prev || prev.voltage <= 250)) {
      addNotification('⚡ Overvoltage', `Voltage spike to ${liveData.voltage.toFixed(0)}V`, 'critical')
    }

    prevData.current = liveData
  }, [liveData])

  const unreadCount = notifications.filter(n => !n.read).length

  const getIcon = (type: string) => {
    switch (type) {
      case 'critical': return <AlertTriangle className="h-4 w-4 text-red-500" />
      case 'warning':  return <Thermometer   className="h-4 w-4 text-orange-500" />
      default:         return <Zap           className="h-4 w-4 text-blue-500" />
    }
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="icon" className="relative rounded-full">
          <Bell className="h-5 w-5" />
          {unreadCount > 0 && (
            <Badge className="absolute -top-1 -right-1 h-5 w-5 p-0 flex items-center justify-center bg-red-500 text-white text-xs animate-pulse">
              {unreadCount > 9 ? '9+' : unreadCount}
            </Badge>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-0" align="end">
        <div className="flex items-center justify-between p-3 border-b">
          <h3 className="font-semibold">Alerts {unreadCount > 0 && <span className="text-red-500">({unreadCount} new)</span>}</h3>
          <div className="flex gap-1">
            {unreadCount > 0 && (
              <Button variant="ghost" size="sm" onClick={() => setNotifications(p => p.map(n => ({ ...n, read: true })))} className="h-7 text-xs">
                Mark all read
              </Button>
            )}
            {notifications.length > 0 && (
              <Button variant="ghost" size="sm" onClick={() => setNotifications([])} className="h-7 text-xs">
                Clear
              </Button>
            )}
          </div>
        </div>
        <div className="max-h-96 overflow-y-auto">
          {notifications.length === 0
            ? <div className="p-6 text-center text-sm text-gray-500">No alerts – system normal ✓</div>
            : notifications.map(n => (
                <div key={n.id} className={`p-3 border-b last:border-0 transition-colors ${!n.read ? 'bg-blue-50 dark:bg-blue-900/20' : 'hover:bg-gray-50 dark:hover:bg-gray-800'}`}>
                  <div className="flex gap-2">
                    <div className="mt-1">{getIcon(n.type)}</div>
                    <div className="flex-1">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <p className="text-sm font-medium">{n.title}</p>
                          <p className="text-xs text-gray-600 dark:text-gray-400 mt-0.5">{n.message}</p>
                          <p className="text-xs text-gray-400 mt-0.5">{n.time}</p>
                        </div>
                        <Button variant="ghost" size="icon" className="h-6 w-6 shrink-0" onClick={() => setNotifications(p => p.filter(x => x.id !== n.id))}>
                          <X className="h-3 w-3" />
                        </Button>
                      </div>
                    </div>
                  </div>
                </div>
              ))
          }
        </div>
      </PopoverContent>
    </Popover>
  )
}
