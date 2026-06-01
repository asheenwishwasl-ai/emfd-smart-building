# EMFD Smart Building — Deployment Guide

> **Complete step-by-step checklist** to migrate from localhost to a publicly accessible
> Vercel deployment with MongoDB Atlas, covering ESP32 URL update, CORS security,
> and multi-device access.

---

## 1 — MongoDB Atlas (Cloud Database)

Your current app uses an in-memory state store. For Vercel serverless functions to share
data across instances and persist billing reset commands, you need Atlas.

### Steps

1. Create a free account at <https://www.mongodb.com/cloud/atlas>
2. Click **Build a Database** → choose **M0 Free Tier** → select the region closest to your users (e.g. `ap-southeast-1` for Sri Lanka)
3. **Database Access** → Add a database user:
   - Username: `emfd_admin`
   - Password: generate a strong password (copy it — you'll need it)
   - Role: **Read and write to any database**
4. **Network Access** → Add IP Address:
   - Click **Allow Access from Anywhere** → `0.0.0.0/0`
   - *(Vercel serverless functions have dynamic IPs — wildcard is required)*
5. **Connect** → **Drivers** → **Node.js** → Copy the connection string:
   ```
   mongodb+srv://emfd_admin:<password>@cluster0.xxxxx.mongodb.net/emfd?retryWrites=true&w=majority
   ```
6. Replace `<password>` with your actual password.

---

## 2 — Environment Variables

### `.env.local` (local development only — never commit this file)

```env
# MongoDB Atlas connection string
MONGODB_URI=mongodb+srv://emfd_admin:YOUR_PASSWORD@cluster0.xxxxx.mongodb.net/emfd?retryWrites=true&w=majority

# NextAuth — generate with: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
NEXTAUTH_SECRET=paste_64_char_hex_string_here

# Local dev URL
NEXTAUTH_URL=http://localhost:3000

# Dashboard admin login (hardcoded in route.ts — update as needed)
ADMIN_EMAIL=admin@yourdomain.com
ADMIN_PASSWORD=change-this-strong-password

# ESP32 device authentication key — must match API_KEY in firmware
DEVICE_SECRET_KEY=esp32-secret-key-2026

# Public variables (exposed to browser)
NEXT_PUBLIC_DEVICE_ID=building-01

# Optional: Telegram / Email alerts
TELEGRAM_BOT_TOKEN=...
TELEGRAM_CHAT_ID=...
RESEND_API_KEY=...
ALERT_EMAIL_TO=...

# Firebase (if used)
FIREBASE_PROJECT_ID=...
FIREBASE_CLIENT_EMAIL=...
FIREBASE_PRIVATE_KEY="..."
NEXT_PUBLIC_FIREBASE_API_KEY=...
# etc.
```

### Vercel Project Settings → Environment Variables

Add **exactly** these keys in your Vercel project dashboard:

| Key | Value |
|---|---|
| `MONGODB_URI` | Atlas connection string (from Step 1) |
| `NEXTAUTH_SECRET` | Strong 64-char random hex string |
| `NEXTAUTH_URL` | `https://your-app.vercel.app` *(your Vercel production URL)* |
| `ADMIN_EMAIL` | Your admin login email |
| `ADMIN_PASSWORD` | Your admin login password |
| `DEVICE_SECRET_KEY` | `esp32-secret-key-2026` *(must match firmware `API_KEY`)* |
| `NEXT_PUBLIC_DEVICE_ID` | `building-01` |
| `TELEGRAM_BOT_TOKEN` | *(optional)* |
| `TELEGRAM_CHAT_ID` | *(optional)* |
| `RESEND_API_KEY` | *(optional)* |
| `ALERT_EMAIL_TO` | *(optional)* |
| Firebase keys | *(if used)* |

> **Important**: `NEXTAUTH_URL` **must** be your live Vercel URL, not `localhost`.
> Session cookies are scoped to this domain — get it from Vercel after first deploy.

---

## 3 — Vercel Deployment Steps

### 3.1 Verify local build first

```bash
npm run build
```

Fix any TypeScript errors before pushing. A passing build locally = a passing Vercel build.

### 3.2 Push to GitHub

```bash
git add .
git commit -m "feat: add billing engine, remote reset, Vercel config"
git push origin main
```

### 3.3 Import project into Vercel

1. Go to <https://vercel.com/new>
2. Click **Import Git Repository** → select your `emfd-smart-building` repo
3. Framework preset: **Next.js** (auto-detected)
4. Root directory: `.` (default)
5. Add all environment variables from the table above
6. Click **Deploy**

### 3.4 After first deploy

- Copy your live URL from Vercel (e.g. `https://emfd-smart-building.vercel.app`)
- Go back to **Settings → Environment Variables** → update `NEXTAUTH_URL` to the live URL
- Trigger a **Redeploy** (Deployments tab → ⋯ → Redeploy)

### 3.5 Subsequent deploys

Any push to the connected branch triggers an automatic redeploy. For firmware-only changes
(no code changes), a manual redeploy is not needed — just reflash the ESP32.

---

## 4 — ESP32 Firmware: Update `SERVER_URL`

After your Vercel deployment is live, open `firmware/emfd_esp32.ino` and change:

```cpp
// BEFORE (local network)
const char* SERVER_URL = "http://192.168.8.123:3000/api/sensor-data";

// AFTER (Vercel production — use HTTPS)
const char* SERVER_URL = "https://emfd-smart-building.vercel.app/api/sensor-data";
```

> **Why HTTPS is required**: Vercel only serves traffic over HTTPS. The ESP32's
> `HTTPClient` supports HTTPS; no SSL certificate pinning setup is needed for
> standard Vercel TLS certificates.

### ESP32 endpoint security

The `/api/sensor-data` endpoint is already secured:

- **`x-api-key` header check**: The server compares the header value to `DEVICE_SECRET_KEY`.
  Any request without a matching key gets a `401 Unauthorized` response.
- **Dashboard reset** (`/api/reset-billing`): Requires a valid NextAuth JWT session cookie —
  the ESP32 cannot call this endpoint.

---

## 5 — NextAuth Multi-Device Login

Once `NEXTAUTH_URL` points to your Vercel URL and `NEXTAUTH_SECRET` is set:

- Any device (phone, tablet, laptop) on **any network** can open the Vercel URL and log in.
- Sessions use signed JWT cookies, scoped to the Vercel domain.
- No extra configuration is needed — JWT sessions work across devices automatically.

**Current credentials** (hardcoded in `app/api/auth/[...nextauth]/route.ts`):
```
Email:    asheen@gmail.com
Password: asheen123
```

> To change: edit the `authorize()` function in that route file, or connect it to MongoDB
> `users` collection using the existing `User` model.

---

## 6 — CORS Policy

| Endpoint | Who can call it | How it's secured |
|---|---|---|
| `POST /api/sensor-data` | ESP32 only | `x-api-key` header |
| `POST /api/reset-billing` | Authenticated browser | NextAuth JWT cookie |
| `GET /api/live` | Authenticated browser (SSE) | Middleware redirects unauthenticated users |
| `GET /api/latest` | Authenticated browser | Middleware |
| `GET /api/history` | Authenticated browser | Middleware |

The `middleware.ts` protects `/dashboard/*` and `/historical/*` from unauthenticated access.
API routes that need device auth use the `x-api-key` header check.
API routes that need user auth use `getToken()` from `next-auth/jwt`.

---

## 7 — Troubleshooting Checklist

| Symptom | Likely cause | Fix |
|---|---|---|
| ESP32 gets `401` after Vercel deploy | `DEVICE_SECRET_KEY` mismatch | Ensure Vercel env var matches firmware `API_KEY` |
| ESP32 gets SSL handshake error | HTTP used instead of HTTPS | Change firmware `SERVER_URL` to `https://` |
| Dashboard login loops | `NEXTAUTH_URL` wrong | Set to exact Vercel URL including `https://` |
| Billing reset not reaching ESP32 | MongoDB not connected | Check `MONGODB_URI` is set in Vercel env vars |
| `reset_billing` not in response | No pending command | Click dashboard button first, then wait for next ESP32 POST |
| Build fails on Vercel | TypeScript error | Run `npm run build` locally to catch errors first |
