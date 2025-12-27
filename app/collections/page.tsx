'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import Image from 'next/image'
import { useAuth } from '@/components/auth/auth-context'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { motion } from 'framer-motion'
import {
  ArrowLeft,
  Loader2,
  Heart,
  FolderPlus,
  Trash2,
  Edit2,
  Check,
  X,
  ImageIcon
} from 'lucide-react'
import { createClient } from '@/utils/supabase/client'
import { toAssetUrl } from '@/lib/assets'
import type { Collection } from '@/lib/supabase/types'

interface CollectionWithThumbnail extends Collection {
  thumbnail_url?: string
}

export default function CollectionsPage() {
  const router = useRouter()
  const {
    user,
    isLoading: authLoading,
    collections,
    collectionsLoading,
    createCollection,
    deleteCollection,
    updateCollection
  } = useAuth()

  const [collectionsWithThumbnails, setCollectionsWithThumbnails] = useState<CollectionWithThumbnail[]>([])
  const [isCreating, setIsCreating] = useState(false)
  const [newCollectionName, setNewCollectionName] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [editingName, setEditingName] = useState('')
  const [deletingId, setDeletingId] = useState<number | null>(null)

  // Redirect if not logged in
  useEffect(() => {
    if (!authLoading && !user) {
      router.push('/auth/signin')
    }
  }, [authLoading, user, router])

  // Fetch thumbnails for collections
  useEffect(() => {
    const fetchThumbnails = async () => {
      if (!collections.length) {
        setCollectionsWithThumbnails([])
        return
      }

      const supabase = createClient()
      const templateIds = collections
        .map(c => c.thumbnail_template_id)
        .filter((id): id is number => id !== null)

      if (!templateIds.length) {
        setCollectionsWithThumbnails(collections.map(c => ({ ...c })))
        return
      }

      const { data: templates } = await supabase
        .from('templates')
        .select('id, screenshot_path')
        .in('id', templateIds)

      const thumbnailMap = new Map(
        templates?.map(t => [t.id, t.screenshot_path]) ?? []
      )

      setCollectionsWithThumbnails(
        collections.map(c => ({
          ...c,
          thumbnail_url: c.thumbnail_template_id
            ? toAssetUrl(thumbnailMap.get(c.thumbnail_template_id) ?? null) ?? undefined
            : undefined
        }))
      )
    }

    fetchThumbnails()
  }, [collections])

  const handleCreateCollection = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newCollectionName.trim()) return

    setIsSubmitting(true)
    await createCollection(newCollectionName.trim())
    setIsSubmitting(false)
    setNewCollectionName('')
    setIsCreating(false)
  }

  const handleUpdateCollection = async (id: number) => {
    if (!editingName.trim()) return

    await updateCollection(id, { name: editingName.trim() })
    setEditingId(null)
    setEditingName('')
  }

  const handleDeleteCollection = async (id: number) => {
    setDeletingId(id)
    await deleteCollection(id)
    setDeletingId(null)
  }

  if (authLoading) {
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
        <div className="max-w-6xl mx-auto px-6 py-6">
          <Link
            href="/"
            className="inline-flex items-center gap-2 text-sm text-neutral-600 hover:text-neutral-900 transition-colors mb-6"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to Gallery
          </Link>

          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold text-neutral-900 tracking-tight">
                My Collections
              </h1>
              <p className="mt-1 text-neutral-600">
                {collections.length} collection{collections.length !== 1 ? 's' : ''}
              </p>
            </div>

            {!isCreating && (
              <Button
                onClick={() => setIsCreating(true)}
                className="rounded-none bg-neutral-900 hover:bg-neutral-800"
              >
                <FolderPlus className="h-4 w-4 mr-2" />
                New Collection
              </Button>
            )}
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-6xl mx-auto px-6 py-8">
        {/* Create new collection form */}
        {isCreating && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            className="mb-8 bg-white border border-neutral-200 p-6"
          >
            <h2 className="text-lg font-semibold text-neutral-900 mb-4">
              Create New Collection
            </h2>
            <form onSubmit={handleCreateCollection} className="flex gap-4">
              <Input
                placeholder="Collection name"
                value={newCollectionName}
                onChange={(e) => setNewCollectionName(e.target.value)}
                className="flex-1 rounded-none border-neutral-300 focus:border-neutral-900 focus:ring-0"
                autoFocus
                disabled={isSubmitting}
              />
              <Button
                type="submit"
                className="rounded-none bg-neutral-900 hover:bg-neutral-800"
                disabled={!newCollectionName.trim() || isSubmitting}
              >
                {isSubmitting ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  'Create'
                )}
              </Button>
              <Button
                type="button"
                variant="outline"
                className="rounded-none"
                onClick={() => {
                  setIsCreating(false)
                  setNewCollectionName('')
                }}
                disabled={isSubmitting}
              >
                Cancel
              </Button>
            </form>
          </motion.div>
        )}

        {/* Collections Grid */}
        {collectionsLoading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="h-8 w-8 animate-spin text-neutral-400" />
          </div>
        ) : collectionsWithThumbnails.length === 0 ? (
          <div className="text-center py-20">
            <div className="w-20 h-20 bg-neutral-100 rounded-full flex items-center justify-center mx-auto mb-6">
              <FolderPlus className="h-10 w-10 text-neutral-400" />
            </div>
            <h2 className="text-xl font-semibold text-neutral-900 mb-2">
              No collections yet
            </h2>
            <p className="text-neutral-600 mb-6">
              Create your first collection to start saving templates.
            </p>
            <Button
              onClick={() => setIsCreating(true)}
              className="rounded-none bg-neutral-900 hover:bg-neutral-800"
            >
              <FolderPlus className="h-4 w-4 mr-2" />
              Create Collection
            </Button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {collectionsWithThumbnails.map((collection) => (
              <motion.div
                key={collection.id}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                className="group bg-white border border-neutral-200 overflow-hidden hover:border-neutral-400 transition-colors"
              >
                {/* Thumbnail */}
                <Link href={`/collections/${collection.id}`}>
                  <div className="relative aspect-[16/10] bg-neutral-100">
                    {collection.thumbnail_url ? (
                      <Image
                        src={collection.thumbnail_url}
                        alt={collection.name}
                        fill
                        className="object-cover"
                      />
                    ) : (
                      <div className="absolute inset-0 flex items-center justify-center">
                        {collection.is_favorites ? (
                          <Heart className="h-12 w-12 text-neutral-300" />
                        ) : (
                          <ImageIcon className="h-12 w-12 text-neutral-300" />
                        )}
                      </div>
                    )}

                    {/* Hover overlay */}
                    <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors" />
                  </div>
                </Link>

                {/* Info */}
                <div className="p-4">
                  <div className="flex items-start justify-between gap-2">
                    {editingId === collection.id ? (
                      <form
                        onSubmit={(e) => {
                          e.preventDefault()
                          handleUpdateCollection(collection.id)
                        }}
                        className="flex-1 flex gap-2"
                      >
                        <Input
                          value={editingName}
                          onChange={(e) => setEditingName(e.target.value)}
                          className="h-8 rounded-none border-neutral-300 focus:border-neutral-900 focus:ring-0 text-sm"
                          autoFocus
                        />
                        <button
                          type="submit"
                          className="p-1.5 hover:bg-neutral-100 transition-colors"
                        >
                          <Check className="h-4 w-4 text-green-600" />
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setEditingId(null)
                            setEditingName('')
                          }}
                          className="p-1.5 hover:bg-neutral-100 transition-colors"
                        >
                          <X className="h-4 w-4 text-neutral-400" />
                        </button>
                      </form>
                    ) : (
                      <>
                        <Link href={`/collections/${collection.id}`} className="flex-1 min-w-0">
                          <h3 className="font-semibold text-neutral-900 truncate flex items-center gap-2">
                            {collection.is_favorites && (
                              <Heart className="h-4 w-4 text-red-500 fill-red-500 flex-shrink-0" />
                            )}
                            {collection.name}
                          </h3>
                          <p className="text-sm text-neutral-500 mt-0.5">
                            {collection.template_count} template{collection.template_count !== 1 ? 's' : ''}
                          </p>
                        </Link>

                        {!collection.is_favorites && (
                          <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                            <button
                              onClick={() => {
                                setEditingId(collection.id)
                                setEditingName(collection.name)
                              }}
                              className="p-1.5 hover:bg-neutral-100 transition-colors"
                              title="Rename collection"
                            >
                              <Edit2 className="h-4 w-4 text-neutral-400" />
                            </button>
                            <button
                              onClick={() => handleDeleteCollection(collection.id)}
                              disabled={deletingId === collection.id}
                              className="p-1.5 hover:bg-red-50 transition-colors"
                              title="Delete collection"
                            >
                              {deletingId === collection.id ? (
                                <Loader2 className="h-4 w-4 animate-spin text-neutral-400" />
                              ) : (
                                <Trash2 className="h-4 w-4 text-red-500" />
                              )}
                            </button>
                          </div>
                        )}
                      </>
                    )}
                  </div>
                </div>
              </motion.div>
            ))}
          </div>
        )}
      </main>
    </div>
  )
}
