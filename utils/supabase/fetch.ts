type SupabaseFetchOptions = {
  timeoutMs: number
  maxRetries?: number
  retryDelayMs?: number
  debugLabel?: string
  debug?: boolean
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms))
}

function shouldRetry(method: string, status?: number) {
  const upper = method.toUpperCase()
  if (upper !== 'GET' && upper !== 'HEAD') return false
  if (status === undefined) return true // network error / abort
  return status === 408 || status === 429 || status === 502 || status === 503 || status === 504
}

/**
 * Supabase uses `fetch` under the hood for auth + PostgREST.
 * This wrapper adds a timeout and (safe) retries for idempotent requests only.
 */
export function createSupabaseFetch(options: SupabaseFetchOptions): typeof fetch {
  const {
    timeoutMs,
    maxRetries = 1,
    retryDelayMs = 150,
    debugLabel = 'supabase',
    debug = false,
  } = options

  return async (input: RequestInfo | URL, init?: RequestInit) => {
    const method = (init?.method ?? 'GET').toUpperCase()
    let lastError: unknown

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), timeoutMs)

      const signal = init?.signal
      if (signal) {
        if (signal.aborted) controller.abort()
        else signal.addEventListener('abort', () => controller.abort(), { once: true })
      }

      try {
        const startedAt = typeof performance !== 'undefined' ? performance.now() : Date.now()
        const res = await fetch(input, { ...init, signal: controller.signal })
        const durationMs = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - startedAt
        if (debug) {
          console.debug(`[${debugLabel}] ${method} ${res.status} in ${Math.round(durationMs)}ms`, input)
        }

        if (attempt < maxRetries && shouldRetry(method, res.status)) {
          await sleep(retryDelayMs * (attempt + 1))
          continue
        }

        return res
      } catch (err) {
        lastError = err
        if (debug) {
          console.debug(`[${debugLabel}] ${method} failed (attempt ${attempt + 1}/${maxRetries + 1})`, err)
        }
        if (attempt < maxRetries && shouldRetry(method)) {
          await sleep(retryDelayMs * (attempt + 1))
          continue
        }
        throw err
      } finally {
        clearTimeout(timeout)
      }
    }

    throw lastError instanceof Error ? lastError : new Error('Supabase fetch failed')
  }
}

