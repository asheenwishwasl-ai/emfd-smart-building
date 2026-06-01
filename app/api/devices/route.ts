/**
 * GET /api/devices
 * ─────────────────────────────────────────────────────────────────────────
 * Returns the list of active device IDs that have reported data to this backend instance.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getActiveDevices } from '@/lib/state';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const devices = getActiveDevices();
    return NextResponse.json({ devices });
  } catch (error) {
    return NextResponse.json({
      error: 'Internal server error',
      details: error instanceof Error ? error.message : 'Unknown error',
    }, { status: 500 });
  }
}
