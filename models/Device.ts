import mongoose, { Schema, Document, Model } from 'mongoose'

export interface IDevice extends Document {
  device_id: string
  name: string
  location: string
  building: string
  floor: number
  owner: string
  api_key: string
  active: boolean
  lastSeen: Date
  createdAt: Date
}

const DeviceSchema = new Schema<IDevice>(
  {
    device_id: { type: String, unique: true, required: true },
    name:      { type: String, required: true },
    location:  { type: String, default: '' },
    building:  { type: String, default: '' },
    floor:     { type: Number, default: 0 },
    owner:     { type: String, required: true },   // user email
    api_key:   { type: String, required: true },   // hashed secret key
    active:    { type: Boolean, default: true },
    lastSeen:  { type: Date, default: Date.now },
  },
  { collection: 'devices', timestamps: true }
)

const Device: Model<IDevice> =
  mongoose.models.Device || mongoose.model<IDevice>('Device', DeviceSchema)

export default Device
