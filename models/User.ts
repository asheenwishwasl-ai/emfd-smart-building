import mongoose, { Schema, Document, Model } from 'mongoose'

export interface IUser extends Document {
  email: string
  password: string
  name: string
  role: 'admin' | 'viewer' | 'technician'
  createdAt: Date
}

const UserSchema = new Schema<IUser>(
  {
    email:    { type: String, unique: true, required: true, lowercase: true },
    password: { type: String, required: true },
    name:     { type: String, default: '' },
    role:     { type: String, enum: ['admin', 'viewer', 'technician'], default: 'viewer' },
  },
  { collection: 'users', timestamps: true }
)

const User: Model<IUser> =
  mongoose.models.User || mongoose.model<IUser>('User', UserSchema)

export default User
