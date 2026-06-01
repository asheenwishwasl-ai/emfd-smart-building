"use client"

import { useState, useEffect } from "react"
import { signIn, useSession } from "next-auth/react"
import { useRouter } from "next/navigation"
import { Building2, Loader2, Shield } from "lucide-react"

export default function Home() {
  const { status } = useSession()
  const router = useRouter()
  const bypassAuth = process.env.NEXT_PUBLIC_BYPASS_AUTH === "true"
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [error, setError] = useState("")
  const [loading, setLoading] = useState(false)
  const [bypassAttempted, setBypassAttempted] = useState(false)

  useEffect(() => {
    if (status === "authenticated") {
      router.replace("/dashboard")
      return
    }

    if (bypassAuth && status === "unauthenticated" && !bypassAttempted) {
      setBypassAttempted(true)
      setLoading(true)
      signIn("credentials", { email: "bypass", password: "bypass", redirect: false })
        .then((result) => {
          if (!result?.error) {
            router.replace("/dashboard")
          } else {
            setError("Authentication bypass failed.")
            setLoading(false)
          }
        })
    }
  }, [status, router, bypassAuth, bypassAttempted])

  if (bypassAuth && status !== "authenticated") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-zinc-50 px-4 py-10 dark:bg-slate-950">
        <div className="rounded-3xl border border-slate-200 bg-white p-10 shadow-xl shadow-slate-200/40 dark:border-slate-800 dark:bg-slate-900 dark:shadow-black/20">
          <div className="flex items-center gap-3 text-sm text-slate-700 dark:text-slate-300">
            <Loader2 className="h-5 w-5 animate-spin text-blue-500" />
            Signing in and redirecting to dashboard…
          </div>
        </div>
      </div>
    )
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError("")
    setLoading(true)
    const result = await signIn("credentials", { email, password, redirect: false })
    if (result?.error) { setError("Invalid email or password."); setLoading(false) }
    else router.push("/dashboard")
  }

  if (status === "loading") {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
      </div>
    )
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-50 px-4 py-10 dark:bg-slate-950">
      <div className="w-full max-w-md rounded-3xl border border-slate-200 bg-white p-10 shadow-xl shadow-slate-200/40 dark:border-slate-800 dark:bg-slate-900 dark:shadow-black/20">
        <div className="mb-8 flex flex-col items-center gap-3">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-blue-600">
            <Building2 className="h-8 w-8 text-white" />
          </div>
          <div className="text-center">
            <h1 className="text-2xl font-bold text-slate-900 dark:text-white">EMFD Smart Building</h1>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Energy Management &amp; Fault Disclosure System</p>
          </div>
        </div>
        <form onSubmit={handleSubmit} className="space-y-5">
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300" htmlFor="email">Email</label>
            <input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)}
              className="mt-2 w-full rounded-2xl border border-slate-300 bg-slate-50 px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-200 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
              placeholder="admin@yourdomain.com" required={!bypassAuth} />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300" htmlFor="password">Password</label>
            <input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)}
              className="mt-2 w-full rounded-2xl border border-slate-300 bg-slate-50 px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-200 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
              placeholder="••••••••" required={!bypassAuth} />
          </div>
          {error && <div className="rounded-2xl bg-red-50 p-3 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-300">{error}</div>}
          <button type="submit" disabled={loading}
            className="inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-blue-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:opacity-60">
            {loading ? <><Loader2 className="h-4 w-4 animate-spin" />Signing in…</> : "Sign in"}
          </button>
        </form>
        <div className="mt-6 rounded-2xl bg-slate-100 px-4 py-4 text-sm text-slate-600 dark:bg-slate-800 dark:text-slate-400">
          <div className="flex items-center gap-2"><Shield className="h-4 w-4 text-blue-500" /><span className="font-medium">First-time setup?</span></div>
          <p className="mt-1 text-xs leading-relaxed">Set <code className="rounded bg-slate-200 px-1 dark:bg-slate-700">ADMIN_EMAIL</code> and <code className="rounded bg-slate-200 px-1 dark:bg-slate-700">ADMIN_PASSWORD</code> in <code className="rounded bg-slate-200 px-1 dark:bg-slate-700">.env.local</code> — admin account is created automatically on first login.</p>
        </div>
      </div>
    </div>
  )
}
