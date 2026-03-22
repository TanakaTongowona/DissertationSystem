"use client"

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { AppHeader } from '@/components/app-header'
import { useAuth } from '@/lib/auth-context'
import { Spinner } from '@/components/ui/spinner'

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isLoading, checkAuthStatus, logout } = useAuth()
  const router = useRouter()

  useEffect(() => {
    // Check if access token exists
    const hasValidToken = checkAuthStatus()
    
    if (!isLoading) {
      if (!hasValidToken || !isAuthenticated) {
        // No valid token or not authenticated - logout and redirect
        logout()
      }
    }
  }, [isAuthenticated, isLoading, checkAuthStatus, logout])

  // Periodically check token validity
  useEffect(() => {
    const checkInterval = setInterval(() => {
      const hasValidToken = checkAuthStatus()
      if (!hasValidToken) {
        logout()
      }
    }, 60000) // Check every minute

    return () => clearInterval(checkInterval)
  }, [checkAuthStatus, logout])

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-4">
          <Spinner className="h-8 w-8 text-primary" />
          <p className="text-muted-foreground">Loading...</p>
        </div>
      </div>
    )
  }

  if (!isAuthenticated) {
    return null
  }

  return (
    <div className="min-h-screen bg-background">
      <AppHeader />
      <main>{children}</main>
    </div>
  )
}
