'use client'

import { createContext, useContext, useEffect, useState, useCallback, useMemo, useRef, type ReactNode } from 'react'
import { createClient } from '@/utils/supabase/client'
import type { User, Session } from '@supabase/supabase-js'
import type { Profile, Collection } from '@/lib/supabase/types'
import { toast } from 'sonner'

const DEBUG_AUTH_ENV = process.env.NEXT_PUBLIC_DEBUG_AUTH === 'true'

function isAuthDebugEnabled() {
  if (DEBUG_AUTH_ENV) return true
  try {
    return typeof window !== 'undefined' && window.localStorage.getItem('DEBUG_AUTH') === '1'
  } catch {
    return false
  }
}

function authDebug(...args: unknown[]) {
  if (!isAuthDebugEnabled()) return
  console.log(...args)
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | null = null
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs)
  })
  return Promise.race([promise, timeoutPromise]).finally(() => {
    if (timeoutId) clearTimeout(timeoutId)
  }) as Promise<T>
}

interface AuthContextType {
  // Auth state
  user: User | null
  session: Session | null
  profile: Profile | null
  isLoading: boolean
  isAdmin: boolean

  // Auth actions
  signIn: (email: string, password: string) => Promise<{ error: Error | null }>
  signUp: (email: string, password: string, fullName?: string) => Promise<{ error: Error | null }>
  signOut: () => Promise<void>
  resetPassword: (email: string) => Promise<{ error: Error | null }>
  updatePassword: (password: string) => Promise<{ error: Error | null }>
  updateProfile: (data: { full_name?: string; avatar_url?: string }) => Promise<{ error: Error | null }>

  // Collections state
  collections: Collection[]
  favoriteTemplateIds: Set<number>
  collectionsLoading: boolean

  // Collection actions
  createCollection: (name: string, description?: string) => Promise<Collection | null>
  deleteCollection: (id: number) => Promise<boolean>
  updateCollection: (id: number, data: { name?: string; description?: string; is_public?: boolean }) => Promise<boolean>

  // Template-Collection actions
  addToCollection: (collectionId: number, templateId: number) => Promise<boolean>
  removeFromCollection: (collectionId: number, templateId: number) => Promise<boolean>
  addToFavorites: (templateId: number) => Promise<boolean>
  removeFromFavorites: (templateId: number) => Promise<boolean>

  // Helpers
  isInFavorites: (templateId: number) => boolean
  getTemplateCollections: (templateId: number) => Promise<Collection[]>
  getFavoritesCollection: () => Collection | undefined
  refreshCollections: () => Promise<void>
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [supabase] = useState(() => createClient())
  const loadSeqRef = useRef(0)
  const lastUserIdRef = useRef<string | null>(null)

  // Auth state
  const [user, setUser] = useState<User | null>(null)
  const [session, setSession] = useState<Session | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  // Collections state
  const [collections, setCollections] = useState<Collection[]>([])
  const [favoriteTemplateIds, setFavoriteTemplateIds] = useState<Set<number>>(new Set())
  const [collectionsLoading, setCollectionsLoading] = useState(false)

  // Derived state
  const isAdmin = useMemo(() => {
    const email = (user?.email || '').toLowerCase()
    return email === 'luminousthemes@gmail.com' || (profile?.is_admin ?? false)
  }, [profile, user?.email])

  // Fetch profile
  const fetchProfile = useCallback(async (userId: string) => {
    const startedAt = typeof performance !== 'undefined' ? performance.now() : Date.now()
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .single()

    if (error) {
      console.error('Error fetching profile:', error)
      return null
    }
    authDebug('[Auth] fetchProfile', {
      userId,
      ok: Boolean(data),
      durationMs: Math.round((typeof performance !== 'undefined' ? performance.now() : Date.now()) - startedAt),
    })
    return data as Profile
  }, [supabase])

  // Fetch collections
  const fetchCollections = useCallback(async (userId: string) => {
    setCollectionsLoading(true)
    try {
      const startedAt = typeof performance !== 'undefined' ? performance.now() : Date.now()
      const { data, error } = await supabase
        .from('collections')
        .select('*')
        .eq('user_id', userId)
        .order('is_favorites', { ascending: false })
        .order('created_at', { ascending: false })

      authDebug('[Auth] fetchCollections', {
        userId,
        count: data?.length ?? 0,
        error: error?.message,
        durationMs: Math.round((typeof performance !== 'undefined' ? performance.now() : Date.now()) - startedAt),
      })

      if (error) {
        console.error('[Auth] Error fetching collections:', error)
        return
      }

      setCollections(data as Collection[])

      // Fetch favorite template IDs
      const favoritesCollection = (data as Collection[]).find(c => c.is_favorites)
      if (favoritesCollection) {
        const { data: favoriteTemplates } = await supabase
          .from('collection_templates')
          .select('template_id')
          .eq('collection_id', favoritesCollection.id)

        if (favoriteTemplates) {
          setFavoriteTemplateIds(new Set(favoriteTemplates.map(ft => ft.template_id)))
        }
      }
    } finally {
      setCollectionsLoading(false)
    }
  }, [supabase])

  // Refresh collections
  const refreshCollections = useCallback(async () => {
    if (user) {
      await fetchCollections(user.id)
    }
  }, [user, fetchCollections])

  const loadUserData = useCallback((userId: string) => {
    const loadSeq = ++loadSeqRef.current
    authDebug('[Auth] loadUserData:start', { userId, loadSeq })

    void (async () => {
      try {
        const [nextProfile] = await Promise.all([
          fetchProfile(userId),
          fetchCollections(userId),
        ])

        if (loadSeqRef.current !== loadSeq) {
          authDebug('[Auth] loadUserData:stale', { userId, loadSeq })
          return
        }
        setProfile(nextProfile)
        authDebug('[Auth] loadUserData:done', { userId, loadSeq })
      } catch (error) {
        if (loadSeqRef.current !== loadSeq) return
        console.error('[Auth] Error loading user data:', error)
      }
    })()
  }, [fetchCollections, fetchProfile])

  // Initialize auth state
  useEffect(() => {
    let mounted = true

    const initAuth = async () => {
      const startedAt = typeof performance !== 'undefined' ? performance.now() : Date.now()
      authDebug('[Auth] initAuth:start')
      try {
        // 1) Fast, local check (does not require network) to avoid blocking UI.
        const { data: { session }, error: sessionError } = await withTimeout(
          supabase.auth.getSession(),
          1500,
          'supabase.auth.getSession()'
        )
        authDebug('[Auth] getSession', { hasSession: Boolean(session), error: sessionError?.message })

        if (!mounted) return
        setSession(session)
        setUser(session?.user ?? null)
        const prevUserId = lastUserIdRef.current
        const nextUserId = session?.user?.id ?? null
        lastUserIdRef.current = nextUserId
        setIsLoading(false)

        if (nextUserId) {
          if (prevUserId !== nextUserId) loadUserData(nextUserId)
        } else {
          loadSeqRef.current++
          setProfile(null)
          setCollections([])
          setFavoriteTemplateIds(new Set())
        }

        // 2) Background validation (network) to catch stale/invalid sessions.
        void (async () => {
          try {
            const { data: { user: verifiedUser }, error: userError } = await withTimeout(
              supabase.auth.getUser(),
              12_000,
              'supabase.auth.getUser()'
            )
            authDebug('[Auth] getUser', { userId: verifiedUser?.id, error: userError?.message })

            if (!mounted) return

            if (userError) {
              const isSessionMissing =
                userError.name === 'AuthSessionMissingError' ||
                userError.message?.includes('Auth session missing') ||
                userError.message?.includes('session_not_found')

              if (isSessionMissing) {
                setUser(null)
                setSession(null)
                lastUserIdRef.current = null
                loadSeqRef.current++
                setProfile(null)
                setCollections([])
                setFavoriteTemplateIds(new Set())
              } else {
                // Transient/network issues shouldn't force a client-side sign-out.
                console.error('[Auth] Error validating user session (keeping current state):', userError)
              }
              return
            }

            // Ensure state matches the verified user (e.g. cookie/session drift).
            setUser(verifiedUser ?? null)
            const prevUserId = lastUserIdRef.current
            const nextUserId = verifiedUser?.id ?? null
            lastUserIdRef.current = nextUserId
            if (nextUserId && prevUserId !== nextUserId) loadUserData(nextUserId)
          } catch (error) {
            // Network/timeout errors: keep current state.
            console.error('[Auth] getUser failed (keeping current state):', error)
          }
        })()
      } catch (error) {
        console.error('[Auth] Error initializing auth:', error)
      } finally {
        if (mounted) setIsLoading(false)
        authDebug('[Auth] initAuth:done', {
          durationMs: Math.round((typeof performance !== 'undefined' ? performance.now() : Date.now()) - startedAt),
        })
      }
    }

    initAuth()

    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (!mounted) return

      authDebug('[Auth] onAuthStateChange', { event, userId: session?.user?.id })
      const prevUserId = lastUserIdRef.current
      const nextUserId = session?.user?.id ?? null
      lastUserIdRef.current = nextUserId

      setSession(session)
      setUser(session?.user ?? null)
      setIsLoading(false)

      const shouldReloadUserData =
        prevUserId !== nextUserId ||
        event === 'SIGNED_IN' ||
        event === 'INITIAL_SESSION' ||
        event === 'USER_UPDATED'

      if (!nextUserId) {
        loadSeqRef.current++
        setProfile(null)
        setCollections([])
        setFavoriteTemplateIds(new Set())
        return
      }

      if (shouldReloadUserData) {
        loadUserData(nextUserId)
      }
    })

    return () => {
      mounted = false
      subscription.unsubscribe()
    }
  }, [supabase, loadUserData])

  // Auth actions
  const signIn = useCallback(async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) {
      toast.error(error.message)
      return { error }
    }
    toast.success('Signed in successfully')
    return { error: null }
  }, [supabase])

  const signUp = useCallback(async (email: string, password: string, fullName?: string) => {
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { full_name: fullName || '' },
        emailRedirectTo: `${window.location.origin}/auth/callback`
      }
    })
    if (error) {
      toast.error(error.message)
      return { error }
    }
    toast.success('Check your email to confirm your account')
    return { error: null }
  }, [supabase])

  const signOut = useCallback(async () => {
    await supabase.auth.signOut()
    toast.success('Signed out successfully')
  }, [supabase])

  const resetPassword = useCallback(async (email: string) => {
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/auth/reset-password`
    })
    if (error) {
      toast.error(error.message)
      return { error }
    }
    toast.success('Check your email for the password reset link')
    return { error: null }
  }, [supabase])

  const updatePassword = useCallback(async (password: string) => {
    const { error } = await supabase.auth.updateUser({ password })
    if (error) {
      toast.error(error.message)
      return { error }
    }
    toast.success('Password updated successfully')
    return { error: null }
  }, [supabase])

  const updateProfile = useCallback(async (data: { full_name?: string; avatar_url?: string }) => {
    if (!user) return { error: new Error('Not authenticated') }

    const { error } = await supabase
      .from('profiles')
      .update(data)
      .eq('id', user.id)

    if (error) {
      toast.error(error.message)
      return { error }
    }

    // Refresh profile
    const updatedProfile = await fetchProfile(user.id)
    setProfile(updatedProfile)
    toast.success('Profile updated successfully')
    return { error: null }
  }, [supabase, user, fetchProfile])

  // Collection actions
  const createCollection = useCallback(async (name: string, description?: string) => {
    if (!user) {
      toast.error('Please sign in to create collections')
      return null
    }

    const { data, error } = await supabase
      .from('collections')
      .insert({
        user_id: user.id,
        name,
        description: description || null,
        is_favorites: false,
        is_public: false
      })
      .select()
      .single()

    if (error) {
      toast.error(error.message)
      return null
    }

    setCollections(prev => [...prev, data as Collection])
    toast.success(`Collection "${name}" created`)
    return data as Collection
  }, [supabase, user])

  const deleteCollection = useCallback(async (id: number) => {
    const collection = collections.find(c => c.id === id)
    if (collection?.is_favorites) {
      toast.error('Cannot delete Favorites collection')
      return false
    }

    const { error } = await supabase
      .from('collections')
      .delete()
      .eq('id', id)

    if (error) {
      toast.error(error.message)
      return false
    }

    setCollections(prev => prev.filter(c => c.id !== id))
    toast.success('Collection deleted')
    return true
  }, [supabase, collections])

  const updateCollection = useCallback(async (id: number, data: { name?: string; description?: string; is_public?: boolean }) => {
    const { error } = await supabase
      .from('collections')
      .update(data)
      .eq('id', id)

    if (error) {
      toast.error(error.message)
      return false
    }

    setCollections(prev => prev.map(c => c.id === id ? { ...c, ...data } : c))
    toast.success('Collection updated')
    return true
  }, [supabase])

  // Template-Collection actions
  const addToCollection = useCallback(async (collectionId: number, templateId: number) => {
    const { error } = await supabase
      .from('collection_templates')
      .insert({ collection_id: collectionId, template_id: templateId })

    if (error) {
      if (error.code === '23505') {
        toast.error('Template already in collection')
      } else {
        toast.error(error.message)
      }
      return false
    }

    // Update local state
    const collection = collections.find(c => c.id === collectionId)
    if (collection?.is_favorites) {
      setFavoriteTemplateIds(prev => new Set([...prev, templateId]))
    }

    // Update collection template count
    setCollections(prev => prev.map(c =>
      c.id === collectionId
        ? { ...c, template_count: c.template_count + 1, thumbnail_template_id: c.thumbnail_template_id || templateId }
        : c
    ))

    return true
  }, [supabase, collections])

  const removeFromCollection = useCallback(async (collectionId: number, templateId: number) => {
    const { error } = await supabase
      .from('collection_templates')
      .delete()
      .eq('collection_id', collectionId)
      .eq('template_id', templateId)

    if (error) {
      toast.error(error.message)
      return false
    }

    // Update local state
    const collection = collections.find(c => c.id === collectionId)
    if (collection?.is_favorites) {
      setFavoriteTemplateIds(prev => {
        const next = new Set(prev)
        next.delete(templateId)
        return next
      })
    }

    // Update collection template count
    setCollections(prev => prev.map(c =>
      c.id === collectionId
        ? { ...c, template_count: Math.max(0, c.template_count - 1) }
        : c
    ))

    return true
  }, [supabase, collections])

  const addToFavorites = useCallback(async (templateId: number) => {
    const favoritesCollection = collections.find(c => c.is_favorites)
    if (!favoritesCollection) {
      toast.error('Favorites collection not found')
      return false
    }
    const result = await addToCollection(favoritesCollection.id, templateId)
    if (result) {
      toast.success('Added to Favorites')
    }
    return result
  }, [collections, addToCollection])

  const removeFromFavorites = useCallback(async (templateId: number) => {
    const favoritesCollection = collections.find(c => c.is_favorites)
    if (!favoritesCollection) {
      toast.error('Favorites collection not found')
      return false
    }
    const result = await removeFromCollection(favoritesCollection.id, templateId)
    if (result) {
      toast.success('Removed from Favorites')
    }
    return result
  }, [collections, removeFromCollection])

  // Helpers
  const isInFavorites = useCallback((templateId: number) => {
    return favoriteTemplateIds.has(templateId)
  }, [favoriteTemplateIds])

  const getTemplateCollections = useCallback(async (templateId: number) => {
    if (!user) return []

    const { data, error } = await supabase
      .from('collection_templates')
      .select('collection_id')
      .eq('template_id', templateId)

    if (error || !data) return []

    const collectionIds = new Set(data.map(ct => ct.collection_id))
    return collections.filter(c => collectionIds.has(c.id))
  }, [supabase, user, collections])

  const getFavoritesCollection = useCallback(() => {
    return collections.find(c => c.is_favorites)
  }, [collections])

  const value: AuthContextType = {
    user,
    session,
    profile,
    isLoading,
    isAdmin,
    signIn,
    signUp,
    signOut,
    resetPassword,
    updatePassword,
    updateProfile,
    collections,
    favoriteTemplateIds,
    collectionsLoading,
    createCollection,
    deleteCollection,
    updateCollection,
    addToCollection,
    removeFromCollection,
    addToFavorites,
    removeFromFavorites,
    isInFavorites,
    getTemplateCollections,
    getFavoritesCollection,
    refreshCollections
  }

  return (
    <AuthContext.Provider value={value}>
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
