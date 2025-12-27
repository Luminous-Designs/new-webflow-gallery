'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useAuth } from '@/components/auth/auth-context'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Loader2, Mail, ArrowLeft, CheckCircle } from 'lucide-react'

export default function ForgotPasswordPage() {
  const { resetPassword } = useAuth()
  const [email, setEmail] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [isSuccess, setIsSuccess] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!email) return

    setIsLoading(true)
    const { error } = await resetPassword(email)
    setIsLoading(false)

    if (!error) {
      setIsSuccess(true)
    }
  }

  if (isSuccess) {
    return (
      <div className="min-h-screen bg-neutral-50 flex flex-col">
        <header className="p-6">
          <Link
            href="/"
            className="inline-flex items-center gap-2 text-sm text-neutral-600 hover:text-neutral-900 transition-colors"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to Gallery
          </Link>
        </header>

        <main className="flex-1 flex items-center justify-center px-6 py-12">
          <div className="w-full max-w-md">
            <div className="bg-white border border-neutral-200 p-8 text-center">
              <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-6">
                <CheckCircle className="h-8 w-8 text-green-600" />
              </div>
              <h1 className="text-2xl font-bold text-neutral-900 tracking-tight">
                Check your email
              </h1>
              <p className="mt-4 text-neutral-600">
                We&apos;ve sent a password reset link to <strong>{email}</strong>.
              </p>
              <Link href="/auth/signin">
                <Button className="mt-6 rounded-none bg-neutral-900 hover:bg-neutral-800">
                  Back to Sign In
                </Button>
              </Link>
            </div>
          </div>
        </main>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-neutral-50 flex flex-col">
      {/* Header */}
      <header className="p-6">
        <Link
          href="/auth/signin"
          className="inline-flex items-center gap-2 text-sm text-neutral-600 hover:text-neutral-900 transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Sign In
        </Link>
      </header>

      {/* Main Content */}
      <main className="flex-1 flex items-center justify-center px-6 py-12">
        <div className="w-full max-w-md">
          <div className="bg-white border border-neutral-200 p-8">
            <div className="text-center mb-8">
              <h1 className="text-2xl font-bold text-neutral-900 tracking-tight">
                Forgot password?
              </h1>
              <p className="mt-2 text-sm text-neutral-600">
                No worries, we&apos;ll send you reset instructions.
              </p>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <label htmlFor="email" className="text-sm font-medium text-neutral-700">
                  Email
                </label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-neutral-400" />
                  <Input
                    id="email"
                    type="email"
                    placeholder="you@example.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="pl-10 rounded-none border-neutral-300 focus:border-neutral-900 focus:ring-0"
                    required
                    disabled={isLoading}
                  />
                </div>
              </div>

              <Button
                type="submit"
                className="w-full rounded-none bg-neutral-900 hover:bg-neutral-800 h-11 text-sm font-medium tracking-wide uppercase"
                disabled={isLoading || !email}
              >
                {isLoading ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Sending...
                  </>
                ) : (
                  'Send reset link'
                )}
              </Button>
            </form>
          </div>
        </div>
      </main>
    </div>
  )
}
