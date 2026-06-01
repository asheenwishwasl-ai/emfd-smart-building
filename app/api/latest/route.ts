/**
 * GET /api/latest?device_id=building-01-floor-1
 * Returns the most recent sensor reading for a device.
 * Falls back to demo data if no real readings exist yet.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getLatest } from '@/lib/state'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const device_id = req.nextUrl.searchParams.get('device_id') || 'building-01'

  try {
    const reading = getLatest(device_id)

    if (!reading) {
      return NextResponse.json({ error: 'No data available for this device' }, { status: 404 })
    }

    return NextResponse.json(reading)
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
