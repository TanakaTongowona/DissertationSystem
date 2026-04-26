import type { Metadata } from 'next'
import { Inter, Merriweather, JetBrains_Mono } from 'next/font/google'
import { Analytics } from '@vercel/analytics/next'
import { ThemeProvider } from '@/components/theme-provider'
import { AuthProvider } from '@/lib/auth-context'
import { Toaster } from '@/components/ui/sonner'
// @ts-expect-error: side-effect import for global CSS
import './globals.css'

const inter = Inter({ 
  subsets: ["latin"],
  variable: '--font-inter',
})

const merriweather = Merriweather({ 
  subsets: ["latin"],
  weight: ['400', '700'],
  variable: '--font-merriweather',
})

const jetbrainsMono = JetBrains_Mono({ 
  subsets: ["latin"],
  variable: '--font-mono',
})

export const metadata: Metadata = {
  title: 'Academic Research Agent',
  description: 'AI-powered academic research assistant for intelligent literature review and knowledge synthesis',
  generator: 'TanTanTongs',
  icons: {
    icon: [
      {
        url: '/ara-icon.png',
        type: 'image/png',
      },
    ],
    apple: '/ara-icon.png',
  },
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${inter.variable} ${merriweather.variable} ${jetbrainsMono.variable} font-sans antialiased`}>
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          <AuthProvider>
            {children}
            <Toaster />
          </AuthProvider>
        </ThemeProvider>
        <Analytics />
      </body>
    </html>
  )
}
