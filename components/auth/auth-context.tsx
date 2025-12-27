'use client'

import { createContext, useContext, useEffect, useState, useCallback, useMemo, type ReactNode } from 'react'
import { createClient } from '@/utils/supabase/client'
import type { User, Session } from '@supabase/supabase-js'
import type { Profile, Collection } from '@/lib/supabase/types'
import { toast } from 'sonner'

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
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .single()

    if (error) {
      console.error('Error fetching profile:', error)
      return null
    }
    return data as Profile
  }, [supabase])

  // Fetch collections
  const fetchCollections = useCallback(async (userId: string) => {
    console.log('[Auth] fetchCollections called for user:', userId)
    setCollectionsLoading(true)
    try {
      const { data, error } = await supabase
        .from('collections')
        .select('*')
        .eq('user_id', userId)
        .order('is_favorites', { ascending: false })
        .order('created_at', { ascending: false })

      console.log('[Auth] fetchCollections result:', { data, error: error?.message })

      if (error) {
        console.error('[Auth] Error fetching collections:', error)
        return
      }

      console.log('[Auth] Setting collections:', data?.length, 'collections')
      setCollections(data as Collection[])

      // Fetch favorite template IDs
      const favoritesCollection = (data as Collection[]).find(c => c.is_favorites)
      console.log('[Auth] Favorites collection:', favoritesCollection)
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

  // Initialize auth state
  useEffect(() => {
    let mounted = true

    const initAuth = async () => {
      console.log('[Auth] Starting initAuth...')
      try {
        // Use getUser() for more reliable auth check
        const { data: { user }, error: userError } = await supabase.auth.getUser()

        console.log('[Auth] getUser result:', { user: user?.id, error: userError?.message })

        if (userError) {
          // Expected on first load when no session exists - not an error
          const isSessionMissing =
            userError.name === 'AuthSessionMissingError' ||
            userError.message?.includes('Auth session missing') ||
            userError.message?.includes('session_not_found');

          if (isSessionMissing) {
            // This is normal for pages that don't require auth
            console.log('[Auth] No active session (expected for guest users)')
          } else {
            console.error('[Auth] Error getting user:', userError)
          }

          if (mounted) {
            setUser(null)
            setSession(null)
            setProfile(null)
            setCollections([])
            setFavoriteTemplateIds(new Set())
          }
          if (mounted) {
            setIsLoading(false)
          }
          return
        }

        if (mounted) {
          setUser(user)
        }

        if (user && mounted) {
          console.log('[Auth] Fetching profile for user:', user.id)
          const profile = await fetchProfile(user.id)
          console.log('[Auth] Profile fetched:', profile)
          if (mounted) {
            setProfile(profile)
          }
          console.log('[Auth] Fetching collections...')
          await fetchCollections(user.id)
          console.log('[Auth] Collections fetched')
        }
      } catch (error) {
        console.error('[Auth] Error initializing auth:', error)
      } finally {
        console.log('[Auth] initAuth complete, setting isLoading=false')
        if (mounted) {
          setIsLoading(false)
        }
      }
    }

    initAuth()

    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      console.log('[Auth] onAuthStateChange:', event, session?.user?.id)
      if (!mounted) return

      setSession(session)
      setUser(session?.user ?? null)

      if (session?.user) {
        const profile = await fetchProfile(session.user.id)
        setProfile(profile)
        await fetchCollections(session.user.id)
      } else {
        setProfile(null)
        setCollections([])
        setFavoriteTemplateIds(new Set())
      }

      if (event === 'SIGNED_OUT') {
        setIsLoading(false)
      }
    })

    return () => {
      mounted = false
      subscription.unsubscribe()
    }
  }, [supabase, fetchProfile, fetchCollections])

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
