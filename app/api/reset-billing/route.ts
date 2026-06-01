/**
 * POST /api/reset-billing
 * ─────────────────────────────────────────────────────────────────────────
 * Queues a remote billing reset command for a specific ESP32 device.
 *
 * Auth:   Requires a valid NextAuth session JWT cookie (browser only).
 *         The ESP32 cannot call this endpoint — it has no cookie.
 *
 * Flow:
 *   Dashboard button → POST { device_id }
 *     → upsert DeviceCommand { pending: true } in MongoDB
 *     → next time ESP32 calls POST /api/sensor-data, command is consumed
 *       and { reset_billing: true } is returned in the response body
 *     → ESP32 firmware calls resetBilling() and emits 3 confirmation beeps
 */

import { NextRequest, NextResponse } from 'next/server'
import { getToken } from 'next-auth/jwt'
import dbConnect from '@/lib/db'
import DeviceCommand from '@/models/DeviceCommand'

export async function POST(req: NextRequest) {
  try {
    // ── Auth: require a valid browser session ────────────────────────────
    const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET })
    if (!token) {
      return NextResponse.json(
        { error: 'Unauthorized — please sign in to the dashboard first.' },
        { status: 401 }
      )
    }

    // ── Parse body ───────────────────────────────────────────────────────
    const body = await req.json().catch(() => ({}))
    const device_id: string = body.device_id || 'building-01'

    // ── Upsert pending reset command ─────────────────────────────────────
    // findOneAndUpdate + upsert guarantees exactly one pending command per
    // device, even if the button is clicked multiple times.
    await dbConnect()
    await DeviceCommand.findOneAndUpdate(
      { device_id, command: 'reset_billing' },
      { pending: true, createdAt: new Date() },
      { upsert: true, new: true }
    )

    console.log(`[reset-billing] ✅ Queued reset_billing for device: ${device_id}`)

    return NextResponse.json({
      success: true,
      message: `Billing reset queued for ${device_id}. Takes effect on the next sensor upload (≤ 1 s).`,
    })
  } catch (error) {
    console.error('[reset-billing] ❌ Error:', error)
    return NextResponse.json(
      {
        error: 'Internal server error',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    )
  }
}
