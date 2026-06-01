/**
 * lib/alerts.ts
 * Sends Telegram alerts when sensor thresholds are exceeded.
 * Set TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID in .env.local
 */

interface SensorPayload {
  device_id: string
  temperature: number
  humidity: number
  voltage: number
  current: number
  power: number
  flame: number
}

export async function sendTelegramAlert(data: SensorPayload): Promise<void> {
  const token   = process.env.TELEGRAM_BOT_TOKEN
  const chat_id = process.env.TELEGRAM_CHAT_ID

  if (!token || !chat_id) return // Silently skip if not configured

  const alerts: string[] = []

  if (data.flame === 1)          alerts.push('🔥 *FLAME DETECTED!*')
  if (data.temperature > 55)     alerts.push(`🌡️ Critical temperature: *${data.temperature}°C*`)
  else if (data.temperature > 45) alerts.push(`⚠️ High temperature: *${data.temperature}°C*`)
  if (data.voltage < 195)        alerts.push(`⚡ Undervoltage: *${data.voltage}V*`)
  if (data.voltage > 250)        alerts.push(`⚡ Overvoltage: *${data.voltage}V*`)

  if (alerts.length === 0) return

  const now = new Date().toLocaleString('en-US', { timeZone: 'Asia/Colombo' })
  const message = [
    `🏢 *EMFD Smart Building Alert*`,
    `📍 Device: \`${data.device_id}\``,
    `⏰ Time: ${now}`,
    ``,
    alerts.join('\n'),
    ``,
    `📊 Current Readings:`,
    `  Temp: ${data.temperature}°C`,
    `  Voltage: ${data.voltage}V | Current: ${data.current}A`,
    `  Power: ${(data.power / 1000).toFixed(2)} kW`,
  ].join('\n')

  try {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id, text: message, parse_mode: 'Markdown' }),
    })
  } catch {
    console.error('[Telegram] Failed to send alert')
  }
}

export function shouldAlert(data: SensorPayload): boolean {
  return (
    data.flame === 1 ||
    data.temperature > 45 ||
    data.voltage < 195 ||
    data.voltage > 250
  )
}
