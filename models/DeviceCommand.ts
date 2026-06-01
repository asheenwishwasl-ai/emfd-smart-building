/**
 * models/DeviceCommand.ts
 * ────────────────────────────────────────────────────────────────────────
 * Stores one-shot commands queued from the dashboard for an ESP32 device.
 *
 * Flow:
 *   1. Dashboard  → POST /api/reset-billing    → upserts { pending: true }
 *   2. ESP32 POST → POST /api/sensor-data      → reads pending command,
 *                                                clears it (pending: false),
 *                                                returns { reset_billing: true }
 *   3. ESP32 firmware parses response and calls resetBilling().
 */

import mongoose, { Schema, Document, Model } from 'mongoose'

export interface IDeviceCommand extends Document {
  device_id: string
  command:   string
  pending:   boolean
  createdAt: Date
}

const DeviceCommandSchema = new Schema<IDeviceCommand>(
  {
    device_id: { type: String, required: true, index: true },
    command:   { type: String, required: true },           // e.g. "reset_billing"
    pending:   { type: Boolean, default: true, index: true },
    createdAt: { type: Date,   default: Date.now },
  },
  { collection: 'device_commands', timestamps: false }
)

// Compound index for the sensor-data endpoint lookup:
//   find({ device_id, command, pending: true })
DeviceCommandSchema.index({ device_id: 1, command: 1, pending: 1 })

// Auto-delete consumed commands after 24 hours (keeps collection tidy)
DeviceCommandSchema.index({ createdAt: 1 }, { expireAfterSeconds: 86_400 })

const DeviceCommand: Model<IDeviceCommand> =
  mongoose.models.DeviceCommand ||
  mongoose.model<IDeviceCommand>('DeviceCommand', DeviceCommandSchema)

export default DeviceCommand
