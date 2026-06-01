"use client"

import { useState, useEffect } from 'react'
import { Bell, Mail, AlertTriangle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { toast } from 'sonner'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'

export function EmailAlerts() {
  const [emailEnabled, setEmailEnabled] = useState(true)
  const [emailAddress, setEmailAddress] = useState('facility.manager@emfd.com')
  const [lastAlert, setLastAlert] = useState<{time: string; message: string} | null>(null)

  const sendAlert = (message: string, type: 'critical' | 'warning' | 'info') => {
    if (!emailEnabled) return

    if (type === 'critical') {
      toast.error(message, {
        description: 'Critical alert sent to facility manager',
        duration: 5000,
        icon: <AlertTriangle className="h-4 w-4" />,
      })
    } else if (type === 'warning') {
      toast.warning(message, {
        description: 'Warning notification sent',
        duration: 4000,
      })
    } else {
      toast.info(message, {
        description: 'Information alert',
        duration: 3000,
      })
    }

    setLastAlert({
      time: new Date().toLocaleTimeString(),
      message: message,
    })
  }

  useEffect(() => {
    const interval = setInterval(() => {
      const random = Math.random()
      
      if (random > 0.8) {
        sendAlert('Critical: High temperature on Floor 2 Panel (47°C)', 'critical')
      } else if (random > 0.6) {
        sendAlert('Warning: Humidity rising in Main Panel', 'warning')
      }
    }, 45000)

    return () => clearInterval(interval)
  }, [emailEnabled])

  return (
    <Card className="mb-6">
      <CardContent className="p-4">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Bell className="h-5 w-5 text-blue-600" />
            <h3 className="font-semibold">Email Alert System</h3>
          </div>
          <div className="flex items-center gap-2">
            <Label htmlFor="email-toggle">Enable Alerts</Label>
            <Switch
              id="email-toggle"
              checked={emailEnabled}
              onCheckedChange={setEmailEnabled}
            />
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <p className="text-sm mb-1">Email address:</p>
            <input
              type="email"
              value={emailAddress}
              onChange={(e) => setEmailAddress(e.target.value)}
              className="w-full rounded border p-2 text-sm"
            />
          </div>
          <div>
            <p className="text-sm mb-1">Last Alert:</p>
            {lastAlert ? (
              <div className="rounded bg-blue-50 p-2 text-sm">
                <p className="font-medium">{lastAlert.time}</p>
                <p>{lastAlert.message}</p>
              </div>
            ) : (
              <p className="text-sm text-gray-400">No recent alerts</p>
            )}
          </div>
        </div>

        <div className="mt-4">
          <Button size="sm" variant="outline" onClick={() => sendAlert('Test alert', 'info')}>
            Send Test Alert
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}