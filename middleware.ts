import { withAuth } from 'next-auth/middleware'
import { NextResponse } from 'next/server'

export default withAuth(
  function middleware(req) {
    // All protected routes are handled by withAuth
    return NextResponse.next()
  },
  {
    callbacks: {
      authorized({ token }) {
        return !!token
      },
    },
  }
)

// Protect these routes — all others are public
export const config = {
  matcher: ['/dashboard/:path*', '/historical/:path*'],
}
