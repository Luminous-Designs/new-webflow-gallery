'use client'

import { useState, useRef, useEffect } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useAuth } from './auth-context'
import { Button } from '@/components/ui/button'
import { motion, AnimatePresence } from 'framer-motion'
import {
  LogOut,
  Settings,
  FolderHeart,
  Shield,
  ChevronDown,
  Loader2
} from 'lucide-react'

export function AuthButton() {
  const router = useRouter()
  const { user, profile, isLoading, isAdmin, signOut } = useAuth()
  const [isOpen, setIsOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  // Close menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setIsOpen(false)
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  // Close menu on escape
  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsOpen(false)
      }
    }

    document.addEventListener('keydown', handleEscape)
    return () => document.removeEventListener('keydown', handleEscape)
  }, [])

  const handleSignOut = async () => {
    setIsOpen(false)
    await signOut()
    router.push('/')
    router.refresh()
  }

  if (isLoading) {
    return (
      <div className="h-10 w-10 flex items-center justify-center">
        <Loader2 className="h-4 w-4 animate-spin text-neutral-400" />
      </div>
    )
  }

  if (!user) {
    return (
      <Link href="/auth/signin">
        <Button
          variant="outline"
          className="rounded-none border-neutral-300 hover:border-neutral-900 hover:bg-neutral-50 h-10 text-sm font-medium"
        >
          Sign In
        </Button>
      </Link>
    )
  }

  // Get initials for avatar
  const getInitials = () => {
    if (profile?.full_name) {
      const names = profile.full_name.split(' ')
      return names.map(n => n[0]).join('').toUpperCase().slice(0, 2)
    }
    return user.email?.[0].toUpperCase() || 'U'
  }

  return (
    <div className="relative" ref={menuRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 h-10 px-3 border border-neutral-200 hover:border-neutral-400 transition-colors bg-white"
      >
        {/* Avatar */}
        <div className="h-7 w-7 bg-neutral-900 text-white text-xs font-semibold flex items-center justify-center">
          {getInitials()}
        </div>

        {/* Admin badge */}
        {isAdmin && (
          <Shield className="h-3.5 w-3.5 text-amber-500" />
        )}

        <ChevronDown className={`h-4 w-4 text-neutral-400 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      {/* Dropdown Menu */}
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            transition={{ duration: 0.15 }}
            className="absolute right-0 mt-2 w-56 bg-white border border-neutral-200 shadow-lg z-50"
          >
            {/* User info */}
            <div className="px-4 py-3 border-b border-neutral-100">
              <p className="text-sm font-medium text-neutral-900 truncate">
                {profile?.full_name || 'User'}
              </p>
              <p className="text-xs text-neutral-500 truncate">
                {user.email}
              </p>
              {isAdmin && (
                <span className="inline-flex items-center gap-1 mt-1 bg-amber-100 text-amber-800 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide">
                  <Shield className="h-2.5 w-2.5" />
                  Admin
                </span>
              )}
            </div>

            {/* Menu items */}
            <div className="py-1">
              <Link
                href="/collections"
                onClick={() => setIsOpen(false)}
                className="flex items-center gap-3 px-4 py-2.5 text-sm text-neutral-700 hover:bg-neutral-50 transition-colors"
              >
                <FolderHeart className="h-4 w-4 text-neutral-400" />
                My Collections
              </Link>

              <Link
                href="/account"
                onClick={() => setIsOpen(false)}
                className="flex items-center gap-3 px-4 py-2.5 text-sm text-neutral-700 hover:bg-neutral-50 transition-colors"
              >
                <Settings className="h-4 w-4 text-neutral-400" />
                Account Settings
              </Link>

              {isAdmin && (
                <Link
                  href="/admin"
                  onClick={() => setIsOpen(false)}
                  className="flex items-center gap-3 px-4 py-2.5 text-sm text-amber-700 hover:bg-amber-50 transition-colors"
                >
                  <Shield className="h-4 w-4 text-amber-500" />
                  Admin Dashboard
                </Link>
              )}
            </div>

            {/* Sign out */}
            <div className="border-t border-neutral-100 py-1">
              <button
                onClick={handleSignOut}
                className="flex items-center gap-3 w-full px-4 py-2.5 text-sm text-red-600 hover:bg-red-50 transition-colors"
              >
                <LogOut className="h-4 w-4" />
                Sign Out
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
