# EMFD Smart Building v2.0

Real-time IoT dashboard: ESP32 → MongoDB Atlas → Next.js → Anywhere in the world.

## Quick Start

```bash
npm install
cp .env.local.example .env.local
# Edit .env.local with your values
npm run dev
```

Open http://localhost:3000 — sign in with ADMIN_EMAIL/ADMIN_PASSWORD from .env.local

## ESP32 Setup

Open firmware/emfd_esp32.ino → fill WIFI_SSID, WIFI_PASSWORD, SERVER_URL, DEVICE_API_KEY → Upload

| Sensor | Pin |
|---|---|
| ZMPT101B Voltage | GPIO 34 |
| ACS712 Current | GPIO 35 |
| DHT22 Temp | GPIO 4 |
| Flame Sensor | GPIO 2 |

## Deploy (Free)

1. Push to GitHub
2. Import to vercel.com
3. Add .env.local values to Vercel dashboard
4. Update ESP32 SERVER_URL to your Vercel URL

## API

| Endpoint | Method | Purpose |
|---|---|---|
| /api/sensor-data | POST | Receive ESP32 data |
| /api/latest | GET | Latest reading |
| /api/live | GET | SSE real-time stream |
| /api/history | GET | Historical aggregated data |
