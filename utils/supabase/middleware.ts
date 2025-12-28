import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import { createSupabaseFetch } from '@/utils/supabase/fetch'

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({
    request,
  })

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !key) {
    return supabaseResponse
  }

  const supabase = createServerClient(
    url,
    key,
    {
      global: {
        fetch: createSupabaseFetch({
          timeoutMs: 12_000,
          maxRetries: 1,
          retryDelayMs: 200,
          debugLabel: 'supabase(middleware)',
          debug: process.env.NEXT_PUBLIC_DEBUG_SUPABASE === 'true',
        }),
      },
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
          supabaseResponse = NextResponse.next({
            request,
          })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  // IMPORTANT: Do not use getSession() here.
  // getSession() is not secure in server context - use getUser() instead.
  // See: https://supabase.com/docs/guides/auth/server-side/nextjs
  await supabase.auth.getUser()

  // Optional: Redirect unauthenticated users from protected routes
  // if (
  //   !user &&
  //   !request.nextUrl.pathname.startsWith('/auth') &&
  //   request.nextUrl.pathname.startsWith('/account')
  // ) {
  //   const url = request.nextUrl.clone()
  //   url.pathname = '/auth/signin'
  //   return NextResponse.redirect(url)
  // }

  return supabaseResponse
}
