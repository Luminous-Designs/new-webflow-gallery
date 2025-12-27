'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { useAuth } from '@/components/auth/auth-context'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Loader2, ArrowLeft, User, Mail, Lock, Shield, Save } from 'lucide-react'
import { toast } from 'sonner'

export default function AccountPage() {
  const router = useRouter()
  const { user, profile, isLoading, isAdmin, updateProfile, updatePassword, signOut } = useAuth()

  const [fullName, setFullName] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [isSavingProfile, setIsSavingProfile] = useState(false)
  const [isSavingPassword, setIsSavingPassword] = useState(false)

  useEffect(() => {
    if (profile) {
      setFullName(profile.full_name || '')
    }
  }, [profile])

  useEffect(() => {
    if (!isLoading && !user) {
      router.push('/auth/signin')
    }
  }, [isLoading, user, router])

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsSavingProfile(true)
    await updateProfile({ full_name: fullName })
    setIsSavingProfile(false)
  }

  const handleSavePassword = async (e: React.FormEvent) => {
    e.preventDefault()

    if (newPassword !== confirmPassword) {
      toast.error('Passwords do not match')
      return
    }

    if (newPassword.length < 6) {
      toast.error('Password must be at least 6 characters')
      return
    }

    setIsSavingPassword(true)
    const { error } = await updatePassword(newPassword)
    setIsSavingPassword(false)

    if (!error) {
      setNewPassword('')
      setConfirmPassword('')
    }
  }

  const handleSignOut = async () => {
    await signOut()
    router.push('/')
  }

  if (isLoading) {
    return (
      <div className="min-h-screen bg-neutral-50 flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-neutral-400" />
      </div>
    )
  }

  if (!user) {
    return null
  }

  return (
    <div className="min-h-screen bg-neutral-50">
      {/* Header */}
      <header className="bg-white border-b border-neutral-200">
        <div className="max-w-3xl mx-auto px-6 py-6">
          <Link
            href="/"
            className="inline-flex items-center gap-2 text-sm text-neutral-600 hover:text-neutral-900 transition-colors mb-6"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to Gallery
          </Link>

          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold text-neutral-900 tracking-tight flex items-center gap-3">
                Account Settings
                {isAdmin && (
                  <span className="inline-flex items-center gap-1 bg-amber-100 text-amber-800 px-2 py-0.5 text-xs font-semibold uppercase tracking-wide">
                    <Shield className="h-3 w-3" />
                    Admin
                  </span>
                )}
              </h1>
              <p className="mt-1 text-neutral-600">{user.email}</p>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-3xl mx-auto px-6 py-8 space-y-8">
        {/* Profile Section */}
        <section className="bg-white border border-neutral-200 p-6">
          <h2 className="text-lg font-semibold text-neutral-900 flex items-center gap-2 mb-6">
            <User className="h-5 w-5 text-neutral-400" />
            Profile Information
          </h2>

          <form onSubmit={handleSaveProfile} className="space-y-4">
            <div className="space-y-2">
              <label htmlFor="email" className="text-sm font-medium text-neutral-700">
                Email
              </label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-neutral-400" />
                <Input
                  id="email"
                  type="email"
                  value={user.email || ''}
                  className="pl-10 rounded-none border-neutral-300 bg-neutral-50"
                  disabled
                />
              </div>
              <p className="text-xs text-neutral-500">Email cannot be changed</p>
            </div>

            <div className="space-y-2">
              <label htmlFor="fullName" className="text-sm font-medium text-neutral-700">
                Full Name
              </label>
              <div className="relative">
                <User className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-neutral-400" />
                <Input
                  id="fullName"
                  type="text"
                  placeholder="Your name"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  className="pl-10 rounded-none border-neutral-300 focus:border-neutral-900 focus:ring-0"
                  disabled={isSavingProfile}
                />
              </div>
            </div>

            <Button
              type="submit"
              className="rounded-none bg-neutral-900 hover:bg-neutral-800"
              disabled={isSavingProfile || fullName === (profile?.full_name || '')}
            >
              {isSavingProfile ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Saving...
                </>
              ) : (
                <>
                  <Save className="h-4 w-4 mr-2" />
                  Save Changes
                </>
              )}
            </Button>
          </form>
        </section>

        {/* Password Section */}
        <section className="bg-white border border-neutral-200 p-6">
          <h2 className="text-lg font-semibold text-neutral-900 flex items-center gap-2 mb-6">
            <Lock className="h-5 w-5 text-neutral-400" />
            Change Password
          </h2>

          <form onSubmit={handleSavePassword} className="space-y-4">
            <div className="space-y-2">
              <label htmlFor="newPassword" className="text-sm font-medium text-neutral-700">
                New Password
              </label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-neutral-400" />
                <Input
                  id="newPassword"
                  type="password"
                  placeholder="Min. 6 characters"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  className="pl-10 rounded-none border-neutral-300 focus:border-neutral-900 focus:ring-0"
                  disabled={isSavingPassword}
                  minLength={6}
                />
              </div>
            </div>

            <div className="space-y-2">
              <label htmlFor="confirmPassword" className="text-sm font-medium text-neutral-700">
                Confirm New Password
              </label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-neutral-400" />
                <Input
                  id="confirmPassword"
                  type="password"
                  placeholder="Confirm your password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  className="pl-10 rounded-none border-neutral-300 focus:border-neutral-900 focus:ring-0"
                  disabled={isSavingPassword}
                />
              </div>
            </div>

            <Button
              type="submit"
              className="rounded-none bg-neutral-900 hover:bg-neutral-800"
              disabled={isSavingPassword || !newPassword || !confirmPassword}
            >
              {isSavingPassword ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Updating...
                </>
              ) : (
                'Update Password'
              )}
            </Button>
          </form>
        </section>

        {/* Admin Link */}
        {isAdmin && (
          <section className="bg-amber-50 border border-amber-200 p-6">
            <h2 className="text-lg font-semibold text-amber-900 flex items-center gap-2 mb-2">
              <Shield className="h-5 w-5 text-amber-600" />
              Admin Access
            </h2>
            <p className="text-amber-800 text-sm mb-4">
              You have administrator privileges. Access the admin dashboard to manage templates and settings.
            </p>
            <Link href="/admin">
              <Button className="rounded-none bg-amber-600 hover:bg-amber-700">
                Go to Admin Dashboard
              </Button>
            </Link>
          </section>
        )}

        {/* Sign Out */}
        <section className="bg-white border border-neutral-200 p-6">
          <h2 className="text-lg font-semibold text-neutral-900 mb-4">Sign Out</h2>
          <p className="text-neutral-600 text-sm mb-4">
            Sign out of your account on this device.
          </p>
          <Button
            variant="outline"
            className="rounded-none border-red-300 text-red-600 hover:bg-red-50 hover:text-red-700"
            onClick={handleSignOut}
          >
            Sign Out
          </Button>
        </section>
      </main>
    </div>
  )
}
