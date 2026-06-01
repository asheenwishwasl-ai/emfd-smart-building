import NextAuth from 'next-auth'
import CredentialsProvider from 'next-auth/providers/credentials'

const handler = NextAuth({
  providers: [
    CredentialsProvider({
      name: 'credentials',
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(credentials) {
        // HARDCODED LOGIN - TEMPORARY FIX
        if (credentials?.email === 'asheen@gmail.com' && credentials?.password === 'asheen123') {
          return {
            id: '1',
            email: 'asheen@gmail.com',
            name: 'Admin',
            role: 'admin',
          }
        }
        return null
      },
    }),
  ],
  session: { strategy: 'jwt' },
  pages: {
    signIn: '/',
  },
  secret: process.env.NEXTAUTH_SECRET,
})

export { handler as GET, handler as POST }