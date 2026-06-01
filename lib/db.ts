/**
 * lib/db.ts
 * ─────────────────────────────────────────────────────────────────────────
 * Cached Mongoose connection for Next.js App Router.
 *
 * Next.js hot-reloads modules in development, which would otherwise create
 * a new Mongoose connection on every file change. Caching the connection
 * on `global` prevents connection pool exhaustion in dev and keeps cold-start
 * latency low on Vercel serverless functions.
 *
 * Usage:
 *   import dbConnect from '@/lib/db'
 *   await dbConnect()
 */

import mongoose from 'mongoose'

declare global {
  // eslint-disable-next-line no-var
  var _mongooseCache: {
    conn: typeof mongoose | null
    promise: Promise<typeof mongoose> | null
  }
}

let cached = global._mongooseCache

if (!cached) {
  cached = global._mongooseCache = { conn: null, promise: null }
}

// ── dbConnect ───────────────────────────────────────────────────────────
export default async function dbConnect(): Promise<typeof mongoose> {
  const MONGODB_URI = process.env.MONGODB_URI

  if (!MONGODB_URI) {
    throw new Error(
      'Please add MONGODB_URI to your .env.local file.\n' +
      'Get it from: MongoDB Atlas → Connect → Drivers → Node.js'
    )
  }

  if (cached.conn) return cached.conn

  if (!cached.promise) {
    const opts: mongoose.ConnectOptions = {
      bufferCommands: false, // fail fast rather than queue indefinitely
    }
    cached.promise = mongoose.connect(MONGODB_URI, opts)
  }

  try {
    cached.conn = await cached.promise
  } catch (err) {
    cached.promise = null   // allow retry on next call
    throw err
  }

  return cached.conn
}
