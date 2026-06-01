/**
 * GET /api/live?device_id=building-01
 * Server‑Sent Events stream — pushes new sensor readings every 3s.
 * The dashboard connects to this endpoint to get real‑time updates.
 */

import { NextRequest } from 'next/server';
import { getLatest } from '@/lib/state';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const device_id = req.nextUrl.searchParams.get('device_id') || 'building-01';

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      let connected = true;

      const send = (data: object) => {
        if (!connected) return;
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
        } catch {
          connected = false;
        }
      };

      // Send heartbeat immediately
      send({ type: 'connected', device_id });

      const poll = async () => {
        if (!connected) return;
        const reading = getLatest(device_id);
        if (reading) {
          send({ type: 'reading', ...reading });
        } else {
          // No data received yet - send a "waiting" status or just stay connected
          send({ type: 'waiting', device_id, message: 'Waiting for device data...' });
        }
      };

      // Poll every 3 seconds
      await poll();
      const interval = setInterval(poll, 3000);

      // Clean up on disconnect
      req.signal.addEventListener('abort', () => {
        connected = false;
        clearInterval(interval);
        try { controller.close(); } catch {}
      });
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
    },
  });
}
