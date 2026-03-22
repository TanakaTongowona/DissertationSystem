"use client"

import React, { createContext, useContext, useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { authApi, User, LoginResponse, API_BASE_URL } from './api'

interface AuthContextType {
  user: User | null
  isLoading: boolean
  isAuthenticated: boolean
  isSuperuser: boolean
  login: (email: string, password: string) => Promise<{ success: boolean; error?: string }>
  signup: (firstName: string, lastName: string, email: string, password: string) => Promise<{ success: boolean; error?: string }>
  logout: () => void
  checkAuthStatus: () => boolean
  refreshUser: () => Promise<void>
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

// Helper to check if token exists
function getAccessToken(): string | null {
  if (typeof window === 'undefined') return null
  return localStorage.getItem('auth_token')
}

// Helper to get stored user data
function getStoredUserData(): { user: User; isSuperuser: boolean } | null {
  if (typeof window === 'undefined') return null
  const userData = localStorage.getItem('user_data')
  if (!userData) return null
  try {
    return JSON.parse(userData)
  } catch {
    return null
  }
}


// Helper to fetch user details from the backend
async function fetchUserDetails(userId: number, token: string): Promise<User | null> {
  try {
    const response = await fetch(`${API_BASE_URL}/users/${userId}`, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    });
    
    if (response.ok) {
      const userData = await response.json();
      return {
        id: userData.id,
        email: userData.email,
        first_name: userData.first_name,
        last_name: userData.last_name,
        is_active: userData.is_active,
        is_superuser: userData.is_superuser,
        created_at: userData.created_at,
      };
    } else if (response.status === 403) {
      // If user can't access their own profile (shouldn't happen with proper permissions)
      console.warn('Not authorized to fetch user details');
    }
  } catch (error) {
    console.error('Failed to fetch user details:', error);
  }
  return null;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [isSuperuser, setIsSuperuser] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  const router = useRouter()

  // Check authentication status - returns true if authenticated
  const checkAuthStatus = useCallback((): boolean => {
    const token = getAccessToken()
    if (!token) {
      // No token - clear state and redirect to login
      setUser(null)
      setIsSuperuser(false)
      return false
    }
    return true
  }, [])

  // Logout function - clears all auth data and redirects
  const logout = useCallback(() => {
    localStorage.removeItem('auth_token')
    localStorage.removeItem('user_data')
    setUser(null)
    setIsSuperuser(false)
    router.push('/login')
  }, [router])

  // Initialize auth state from localStorage
  useEffect(() => {
    const token = getAccessToken()
    
    if (!token) {
      setUser(null)
      setIsSuperuser(false)
      setIsLoading(false)
      return
    }

    // Token exists, try to restore user data
    const storedData = getStoredUserData()
    if (storedData) {
      setUser(storedData.user)
      setIsSuperuser(storedData.isSuperuser)
    }
    
    setIsLoading(false)
  }, [])

  // Login function - updated to fetch complete user data
  const login = async (email: string, password: string) => {
    const { data, error } = await authApi.login(email, password)
    
    if (error) {
      return { success: false, error }
    }
    
    if (data) {
      // Store access token
      localStorage.setItem('auth_token', data.access_token)
      
      // Fetch full user details using the user_id from login response
      const fullUserData = await fetchUserDetails(data.user_id, data.access_token);
      
      if (fullUserData) {
        // Store the complete user data
        localStorage.setItem('user_data', JSON.stringify({
          user: fullUserData,
          isSuperuser: fullUserData.is_superuser,
        }))
        
        setUser(fullUserData)
        setIsSuperuser(fullUserData.is_superuser)
        
        return { success: true }
      } else {
        // Fallback to basic user data if fetch fails
        // Create user with email from login form
        const basicUser: User = {
          id: data.user_id,
          email: email,
          first_name: '',
          last_name: '',
          is_active: true,
          is_superuser: data.is_superuser,
          created_at: new Date().toISOString(),
        }
        
        localStorage.setItem('user_data', JSON.stringify({
          user: basicUser,
          isSuperuser: data.is_superuser,
        }))
        
        setUser(basicUser)
        setIsSuperuser(data.is_superuser)
        
        // Return success but with a warning
        return { success: true, error: 'Could not fetch complete user details' }
      }
    }
    
    return { success: false, error: 'Unknown error' }
  }

  // Signup function
  const signup = async (firstName: string, lastName: string, email: string, password: string) => {
    const { data, error } = await authApi.register(firstName, lastName, email, password)
    
    if (error) {
      return { success: false, error }
    }
    
    if (data) {
      // Registration successful - user needs to login
      return { success: true }
    }
    
    return { success: false, error: 'Unknown error' }
  }

  // Refresh user data from the server
  const refreshUser = useCallback(async () => {
    const token = getAccessToken()
    const storedData = getStoredUserData()
    
    if (!token || !storedData?.user?.id) {
      return
    }
    
    const fullUserData = await fetchUserDetails(storedData.user.id, token)
    
    if (fullUserData) {
      localStorage.setItem('user_data', JSON.stringify({
        user: fullUserData,
        isSuperuser: fullUserData.is_superuser,
      }))
      
      setUser(fullUserData)
      setIsSuperuser(fullUserData.is_superuser)
    }
  }, [])

  return (
    <AuthContext.Provider
      value={{
        user,
        isLoading,
        isAuthenticated: !!user,
        isSuperuser,
        login,
        signup,
        logout,
        checkAuthStatus,
        refreshUser,
      }}
    >
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider')
  }
  return context
}
