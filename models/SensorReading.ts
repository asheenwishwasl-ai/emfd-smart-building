import mongoose, { Schema, Document, Model } from 'mongoose'

export interface ISensorReading extends Document {
  device_id: string
  temperature: number
  humidity: number
  voltage: number
  current: number
  power: number
  energy_kwh: number
  flame: number
  power_factor: number
  createdAt: Date
}

const SensorReadingSchema = new Schema<ISensorReading>(
  {
    device_id:    { type: String, required: true, index: true },
    temperature:  { type: Number, required: true },
    humidity:     { type: Number, required: true },
    voltage:      { type: Number, required: true },
    current:      { type: Number, required: true },
    power:        { type: Number, required: true },
    energy_kwh:   { type: Number, default: 0 },
    flame:        { type: Number, default: 0 },
    power_factor: { type: Number, default: 1.0 },
    createdAt:    { type: Date, default: Date.now },
  },
  { collection: 'sensor_readings', timestamps: false }
)

// Auto-delete readings older than 90 days
SensorReadingSchema.index({ createdAt: 1 }, { expireAfterSeconds: 7_776_000 })

// Compound index for fast per-device queries
SensorReadingSchema.index({ device_id: 1, createdAt: -1 })

const SensorReading: Model<ISensorReading> =
  mongoose.models.SensorReading ||
  mongoose.model<ISensorReading>('SensorReading', SensorReadingSchema)

export default SensorReading
