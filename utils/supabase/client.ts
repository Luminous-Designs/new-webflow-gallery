import { createBrowserClient } from '@supabase/ssr'
import { createSupabaseFetch } from '@/utils/supabase/fetch'

export function createClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !key) {
    throw new Error('Missing Supabase env. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY.')
  }
  if (key.startsWith('sb_publishable_')) {
    // Supabase "publishable" keys are not valid for password auth flows.
    // Use the legacy anon key (JWT) for `NEXT_PUBLIC_SUPABASE_ANON_KEY`.
    console.warn('[Supabase] NEXT_PUBLIC_SUPABASE_ANON_KEY looks like a publishable key; password auth will fail.')
  }
  const debug = process.env.NEXT_PUBLIC_DEBUG_SUPABASE === 'true'
  return createBrowserClient(url, key, {
    global: {
      fetch: createSupabaseFetch({
        timeoutMs: 12_000,
        maxRetries: 1,
        retryDelayMs: 200,
        debugLabel: 'supabase',
        debug,
      }),
    },
  })
}
