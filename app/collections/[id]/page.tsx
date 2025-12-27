'use client'

import { useState, useEffect, use } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import Image from 'next/image'
import { useAuth } from '@/components/auth/auth-context'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { motion } from 'framer-motion'
import {
  ArrowLeft,
  Loader2,
  Heart,
  Trash2,
  Edit2,
  Check,
  X,
  Eye,
  ExternalLink,
  Calendar,
  User
} from 'lucide-react'
import { createClient } from '@/utils/supabase/client'
import { toAssetUrl } from '@/lib/assets'
import type { Collection } from '@/lib/supabase/types'
import type { Template } from '@/types/template'
import TemplatePreview from '@/components/template-preview'

interface TemplateInCollection extends Template {
  added_at: string
}

export default function CollectionDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const router = useRouter()
  const {
    user,
    isLoading: authLoading,
    collections,
    removeFromCollection,
    updateCollection,
    deleteCollection
  } = useAuth()

  const [collection, setCollection] = useState<Collection | null>(null)
  const [templates, setTemplates] = useState<TemplateInCollection[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isEditing, setIsEditing] = useState(false)
  const [editingName, setEditingName] = useState('')
  const [removingId, setRemovingId] = useState<number | null>(null)
  const [previewTemplate, setPreviewTemplate] = useState<Template | null>(null)

  // Find collection from context
  useEffect(() => {
    const found = collections.find(c => c.id === parseInt(id))
    if (found) {
      setCollection(found)
      setEditingName(found.name)
    }
  }, [collections, id])

  // Redirect if not logged in
  useEffect(() => {
    if (!authLoading && !user) {
      router.push('/auth/signin')
    }
  }, [authLoading, user, router])

  // Fetch templates in collection
  useEffect(() => {
    const fetchTemplates = async () => {
      if (!user) return

      setIsLoading(true)
      const supabase = createClient()

      // Get template IDs in this collection
      const { data: collectionTemplates, error: ctError } = await supabase
        .from('collection_templates')
        .select('template_id, added_at')
        .eq('collection_id', parseInt(id))
        .order('added_at', { ascending: false })

      if (ctError || !collectionTemplates?.length) {
        setTemplates([])
        setIsLoading(false)
        return
      }

      const templateIds = collectionTemplates.map(ct => ct.template_id)
      const addedAtMap = new Map(collectionTemplates.map(ct => [ct.template_id, ct.added_at]))

      // Fetch templates
      const { data: templatesData, error: tError } = await supabase
        .from('templates')
        .select('*')
        .in('id', templateIds)

      if (tError || !templatesData) {
        setTemplates([])
        setIsLoading(false)
        return
      }

      // Add added_at and required fields to each template
      const templatesWithDate: TemplateInCollection[] = templatesData.map(t => ({
        id: t.id,
        template_id: t.template_id,
        name: t.name,
        slug: t.slug,
        author_name: t.author_name ?? undefined,
        author_id: t.author_id ?? undefined,
        storefront_url: t.storefront_url,
        live_preview_url: t.live_preview_url,
        designer_preview_url: t.designer_preview_url ?? undefined,
        price: t.price ?? undefined,
        short_description: t.short_description ?? undefined,
        screenshot_path: t.screenshot_path ?? undefined,
        subcategories: [],
        styles: [],
        created_at: t.created_at,
        added_at: addedAtMap.get(t.id) || ''
      }))

      // Sort by added_at (newest first)
      templatesWithDate.sort((a, b) =>
        new Date(b.added_at).getTime() - new Date(a.added_at).getTime()
      )

      setTemplates(templatesWithDate)
      setIsLoading(false)
    }

    fetchTemplates()
  }, [user, id])

  const handleUpdateName = async () => {
    if (!collection || !editingName.trim()) return

    await updateCollection(collection.id, { name: editingName.trim() })
    setIsEditing(false)
  }

  const handleRemoveTemplate = async (templateId: number) => {
    if (!collection) return

    setRemovingId(templateId)
    await removeFromCollection(collection.id, templateId)
    setTemplates(prev => prev.filter(t => t.id !== templateId))
    setRemovingId(null)
  }

  const handleDeleteCollection = async () => {
    if (!collection || collection.is_favorites) return

    if (confirm('Are you sure you want to delete this collection? This cannot be undone.')) {
      await deleteCollection(collection.id)
      router.push('/collections')
    }
  }

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    })
  }

  if (authLoading || (isLoading && !collection)) {
    return (
      <div className="min-h-screen bg-neutral-50 flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-neutral-400" />
      </div>
    )
  }

  if (!user) {
    return null
  }

  if (!collection) {
    return (
      <div className="min-h-screen bg-neutral-50 flex flex-col items-center justify-center">
        <h1 className="text-xl font-semibold text-neutral-900 mb-4">Collection not found</h1>
        <Link href="/collections">
          <Button className="rounded-none">Back to Collections</Button>
        </Link>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-neutral-50">
      {/* Header */}
      <header className="bg-white border-b border-neutral-200">
        <div className="max-w-6xl mx-auto px-6 py-6">
          <Link
            href="/collections"
            className="inline-flex items-center gap-2 text-sm text-neutral-600 hover:text-neutral-900 transition-colors mb-6"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to Collections
          </Link>

          <div className="flex items-start justify-between gap-4">
            <div className="flex-1 min-w-0">
              {isEditing ? (
                <form
                  onSubmit={(e) => {
                    e.preventDefault()
                    handleUpdateName()
                  }}
                  className="flex gap-2 items-center"
                >
                  <Input
                    value={editingName}
                    onChange={(e) => setEditingName(e.target.value)}
                    className="text-2xl font-bold rounded-none border-neutral-300 focus:border-neutral-900 focus:ring-0 h-12"
                    autoFocus
                  />
                  <button
                    type="submit"
                    className="p-2 hover:bg-neutral-100 transition-colors"
                  >
                    <Check className="h-5 w-5 text-green-600" />
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setIsEditing(false)
                      setEditingName(collection.name)
                    }}
                    className="p-2 hover:bg-neutral-100 transition-colors"
                  >
                    <X className="h-5 w-5 text-neutral-400" />
                  </button>
                </form>
              ) : (
                <h1 className="text-2xl font-bold text-neutral-900 tracking-tight flex items-center gap-3">
                  {collection.is_favorites && (
                    <Heart className="h-6 w-6 text-red-500 fill-red-500 flex-shrink-0" />
                  )}
                  {collection.name}
                </h1>
              )}
              <p className="mt-1 text-neutral-600">
                {templates.length} template{templates.length !== 1 ? 's' : ''}
              </p>
            </div>

            {!collection.is_favorites && !isEditing && (
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="rounded-none"
                  onClick={() => setIsEditing(true)}
                >
                  <Edit2 className="h-4 w-4 mr-2" />
                  Rename
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="rounded-none border-red-300 text-red-600 hover:bg-red-50"
                  onClick={handleDeleteCollection}
                >
                  <Trash2 className="h-4 w-4 mr-2" />
                  Delete
                </Button>
              </div>
            )}
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-6xl mx-auto px-6 py-8">
        {isLoading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {[...Array(6)].map((_, i) => (
              <div key={i} className="space-y-4">
                <Skeleton className="aspect-[16/10] w-full rounded-none" />
                <Skeleton className="h-6 w-3/4 rounded-none" />
                <Skeleton className="h-4 w-1/2 rounded-none" />
              </div>
            ))}
          </div>
        ) : templates.length === 0 ? (
          <div className="text-center py-20">
            <div className="w-20 h-20 bg-neutral-100 rounded-full flex items-center justify-center mx-auto mb-6">
              {collection.is_favorites ? (
                <Heart className="h-10 w-10 text-neutral-300" />
              ) : (
                <Eye className="h-10 w-10 text-neutral-300" />
              )}
            </div>
            <h2 className="text-xl font-semibold text-neutral-900 mb-2">
              No templates yet
            </h2>
            <p className="text-neutral-600 mb-6">
              Browse the gallery and save templates to this collection.
            </p>
            <Link href="/">
              <Button className="rounded-none bg-neutral-900 hover:bg-neutral-800">
                Browse Templates
              </Button>
            </Link>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {templates.map((template) => (
              <motion.article
                key={template.id}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                className="group bg-white border border-neutral-200 overflow-hidden hover:border-neutral-400 transition-colors"
              >
                {/* Image */}
                <div className="relative aspect-[16/10] bg-neutral-100">
                  {template.screenshot_path && toAssetUrl(template.screenshot_path) ? (
                    <Image
                      src={toAssetUrl(template.screenshot_path)!}
                      alt={template.name}
                      fill
                      className="object-cover"
                    />
                  ) : (
                    <div className="absolute inset-0 flex items-center justify-center">
                      <span className="text-neutral-400 text-sm">No preview</span>
                    </div>
                  )}

                  {/* Hover overlay */}
                  <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent opacity-0 group-hover:opacity-100 transition-opacity flex flex-col justify-between p-4">
                    {/* Remove button */}
                    <div className="flex justify-end">
                      <button
                        onClick={() => handleRemoveTemplate(template.id)}
                        disabled={removingId === template.id}
                        className="p-2 bg-white/90 hover:bg-white text-red-600 transition-colors"
                        title="Remove from collection"
                      >
                        {removingId === template.id ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Trash2 className="h-4 w-4" />
                        )}
                      </button>
                    </div>

                    {/* Action buttons */}
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        variant="secondary"
                        className="flex-1 bg-white/90 hover:bg-white text-neutral-900 border-0 rounded-none h-10 text-xs font-medium tracking-wide uppercase"
                        onClick={() => setPreviewTemplate(template)}
                      >
                        <Eye className="h-4 w-4 mr-2" />
                        Preview
                      </Button>
                      <Button
                        size="sm"
                        className="flex-1 bg-neutral-900 hover:bg-neutral-800 text-white border-0 rounded-none h-10 text-xs font-medium tracking-wide uppercase"
                        onClick={() => window.open(template.storefront_url, '_blank')}
                      >
                        <ExternalLink className="h-4 w-4 mr-2" />
                        Buy Now
                      </Button>
                    </div>
                  </div>
                </div>

                {/* Info */}
                <div className="p-4 space-y-2">
                  <h3 className="font-semibold text-neutral-900 truncate">
                    {template.name}
                  </h3>

                  <div className="flex items-center justify-between text-sm text-neutral-500">
                    <span className="flex items-center gap-1.5">
                      <User className="h-3.5 w-3.5" />
                      {template.author_name || 'Unknown'}
                    </span>
                    <span className="flex items-center gap-1.5">
                      <Calendar className="h-3.5 w-3.5" />
                      {formatDate(template.added_at)}
                    </span>
                  </div>

                  <div className="pt-2 border-t border-neutral-100">
                    <span className="text-lg font-semibold text-neutral-900">
                      {template.price || 'Free'}
                    </span>
                  </div>
                </div>
              </motion.article>
            ))}
          </div>
        )}
      </main>

      {/* Template Preview Modal */}
      <TemplatePreview
        template={previewTemplate}
        isOpen={!!previewTemplate}
        onClose={() => setPreviewTemplate(null)}
        primaryAction={{
          label: 'Buy Template',
          onClick: (template) => {
            window.open(template.storefront_url, '_blank')
            setPreviewTemplate(null)
          },
        }}
      />
    </div>
  )
}
