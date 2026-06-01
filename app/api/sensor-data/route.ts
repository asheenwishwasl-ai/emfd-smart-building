/**
 * POST /api/sensor-data
 * ─────────────────────────────────────────────────────────────────────────
 * Receives sensor telemetry from the ESP32 firmware.
 *
 * [MOD] Now also:
 *   • Accepts monthly_kwh and monthly_bill_lkr in the payload.
 *   • Checks MongoDB for a pending reset_billing command for this device.
 *   • If found: clears the flag and returns { reset_billing: true } so the
 *     ESP32 firmware can call resetBilling() on the next loop cycle.
 *
 * DB errors are non-fatal — sensor data is always stored in memory even
 * if MongoDB is unreachable (fail-open approach for safety).
 */

import { NextRequest, NextResponse } from 'next/server';
import { setLatest } from '@/lib/state';
import dbConnect from '@/lib/db';
import DeviceCommand from '@/models/DeviceCommand';
import SensorReading from '@/models/SensorReading';

export async function POST(request: NextRequest) {
  try {
    // ── Auth: verify ESP32 API key ───────────────────────────────────────
    const deviceId = request.headers.get('x-device-id') || request.headers.get('X-Device-ID') || 'building-01';
    let apiKey = request.headers.get('x-api-key') || request.headers.get('X-API-Key');

    // Fallback to Authorization: Bearer <key>
    const authHeader = request.headers.get('Authorization');
    if (!apiKey && authHeader && authHeader.startsWith('Bearer ')) {
      apiKey = authHeader.split(' ')[1];
    }

    const expectedApiKey = process.env.DEVICE_SECRET_KEY;

    console.log('[sensor-data] ===== New Data Received =====');
    console.log('[sensor-data] Device ID:', deviceId);
    console.log('[sensor-data] API Key received:', apiKey ? '***' + apiKey.slice(-4) : 'null');
    console.log('[sensor-data] Expected Key:', expectedApiKey ? '***' + expectedApiKey.slice(-4) : 'UNDEFINED');

    if (!apiKey || apiKey !== expectedApiKey) {
      console.log('[sensor-data] ❌ Unauthorized - wrong or missing API key');
      return NextResponse.json({
        error: 'Unauthorized',
        received: apiKey ? 'present' : 'missing',
        expected: expectedApiKey ? 'configured' : 'missing',
      }, { status: 401 });
    }

    // ── Parse body ───────────────────────────────────────────────────────
    const body = await request.json();
    console.log('[sensor-data] Sensor data:', body);

    const {
      temperature, humidity, voltage, current, power,
      energy_kwh, power_factor,
      monthly_kwh, monthly_bill_lkr,  // [NEW] billing fields from firmware
    } = body;

    // Map ESP32 boolean flame_detected → numeric flame (1|0) for dashboard
    let flameValue = 0;
    if (body.flame !== undefined) {
      flameValue = Number(body.flame);
    } else if (body.flame_detected !== undefined) {
      flameValue = body.flame_detected ? 1 : 0;
    }

    // Filter sensor failure sentinels (-999) → undefined (renders as '—' in UI)
    const filteredTemp = temperature === -999 ? undefined : temperature;
    const filteredHum  = humidity   === -999 ? undefined : humidity;

    // ── Build reading object ─────────────────────────────────────────────
    const readingData = {
      device_id:       deviceId,
      temperature:     filteredTemp,
      humidity:        filteredHum,
      voltage,
      current,
      power,
      flame:           flameValue,
      energy_kwh:      energy_kwh      || 0,
      power_factor:    power_factor    || 0.9,
      monthly_kwh:     monthly_kwh     || 0,   // [NEW]
      monthly_bill_lkr: monthly_bill_lkr || 0,  // [NEW]
      createdAt:       new Date().toISOString(),
    };

    // Store in in-memory state (SSE stream reads from here)
    setLatest(readingData);

    // ── [NEW] Check for a pending remote billing reset command ────────────
    // Non-fatal: if MongoDB is down, we still return 201 for sensor data.
    let resetBilling = false;
    try {
      await dbConnect();
      
      // Save sensor reading to MongoDB
      await SensorReading.create({
        device_id: deviceId,
        temperature: filteredTemp ?? 0,
        humidity: filteredHum ?? 0,
        voltage: voltage ?? 0,
        current: current ?? 0,
        power: power ?? 0,
        flame: flameValue,
        energy_kwh: energy_kwh || 0,
        power_factor: power_factor || 0.9,
        createdAt: new Date()
      });
      console.log('[sensor-data] ✅ Telemetry saved to MongoDB');

      const pendingCmd = await DeviceCommand.findOneAndUpdate(
        { device_id: deviceId, command: 'reset_billing', pending: true },
        { pending: false },   // atomically consume the command
        { new: true }
      );
      if (pendingCmd) {
        resetBilling = true;
        console.log(`[sensor-data] ✅ Remote billing reset consumed for device: ${deviceId}`);
      }
    } catch (dbErr) {
      console.warn('[sensor-data] ⚠️ MongoDB database operation failed (non-fatal):', (dbErr as Error).message);
    }

    console.log('[sensor-data] ✅ Data stored successfully');
    console.log('[sensor-data] =================================\n');

    return NextResponse.json({
      success: true,
      message: 'Data received successfully',
      data: readingData,
      // Only include reset_billing key when true — ESP32 checks for this
      ...(resetBilling && { reset_billing: true }),
    }, { status: 201 });

  } catch (error) {
    console.error('[sensor-data] ❌ Error:', error);
    return NextResponse.json({
      error: 'Internal server error',
      details: error instanceof Error ? error.message : 'Unknown error',
    }, { status: 500 });
  }
}
