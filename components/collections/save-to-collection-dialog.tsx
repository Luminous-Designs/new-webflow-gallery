'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import { useAuth } from '@/components/auth/auth-context'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Heart,
  FolderPlus,
  Check,
  Loader2,
  X,
  LogIn
} from 'lucide-react'
import type { Collection } from '@/lib/supabase/types'

interface SaveToCollectionDialogProps {
  isOpen: boolean
  onClose: () => void
  templateId: number
  templateName: string
  thumbnailUrl?: string
}

export function SaveToCollectionDialog({
  isOpen,
  onClose,
  templateId,
  templateName,
  thumbnailUrl
}: SaveToCollectionDialogProps) {
  const {
    user,
    collections,
    collectionsLoading,
    isInFavorites,
    addToFavorites,
    removeFromFavorites,
    addToCollection,
    removeFromCollection,
    createCollection,
    getTemplateCollections
  } = useAuth()

  const [templateCollections, setTemplateCollections] = useState<Collection[]>([])
  const [isLoadingCollections, setIsLoadingCollections] = useState(false)
  const [loadingCollectionId, setLoadingCollectionId] = useState<number | null>(null)
  const [isCreating, setIsCreating] = useState(false)
  const [newCollectionName, setNewCollectionName] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)

  // Fetch which collections this template is in
  useEffect(() => {
    if (isOpen && user) {
      setIsLoadingCollections(true)
      getTemplateCollections(templateId).then(cols => {
        setTemplateCollections(cols)
        setIsLoadingCollections(false)
      })
    }
  }, [isOpen, user, templateId, getTemplateCollections])

  const handleToggleCollection = async (collection: Collection) => {
    const isInCollection = templateCollections.some(c => c.id === collection.id)
    setLoadingCollectionId(collection.id)

    if (collection.is_favorites) {
      if (isInCollection) {
        await removeFromFavorites(templateId)
      } else {
        await addToFavorites(templateId)
      }
    } else {
      if (isInCollection) {
        await removeFromCollection(collection.id, templateId)
      } else {
        await addToCollection(collection.id, templateId)
      }
    }

    // Update local state
    if (isInCollection) {
      setTemplateCollections(prev => prev.filter(c => c.id !== collection.id))
    } else {
      setTemplateCollections(prev => [...prev, collection])
    }

    setLoadingCollectionId(null)
  }

  const handleCreateCollection = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newCollectionName.trim()) return

    setIsSubmitting(true)
    const newCollection = await createCollection(newCollectionName.trim())
    setIsSubmitting(false)

    if (newCollection) {
      // Auto-add template to the new collection
      setLoadingCollectionId(newCollection.id)
      await addToCollection(newCollection.id, templateId)
      setTemplateCollections(prev => [...prev, newCollection])
      setLoadingCollectionId(null)

      setNewCollectionName('')
      setIsCreating(false)
    }
  }

  // Not logged in - show sign-in prompt
  if (!user) {
    return (
      <Dialog open={isOpen} onOpenChange={() => onClose()}>
        <DialogContent className="sm:max-w-md rounded-none" showCloseButton={false}>
          <DialogHeader>
            <DialogTitle className="text-center">Sign in to save templates</DialogTitle>
          </DialogHeader>
          <div className="text-center py-6">
            <div className="w-16 h-16 bg-neutral-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <Heart className="h-8 w-8 text-neutral-400" />
            </div>
            <p className="text-neutral-600 mb-6">
              Create an account to save your favorite templates and organize them into collections.
            </p>
            <div className="flex flex-col sm:flex-row gap-3 justify-center">
              <Link href="/auth/signin" onClick={onClose}>
                <Button className="rounded-none bg-neutral-900 hover:bg-neutral-800 w-full sm:w-auto">
                  <LogIn className="h-4 w-4 mr-2" />
                  Sign In
                </Button>
              </Link>
              <Link href="/auth/signup" onClick={onClose}>
                <Button variant="outline" className="rounded-none w-full sm:w-auto">
                  Create Account
                </Button>
              </Link>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    )
  }

  return (
    <Dialog open={isOpen} onOpenChange={() => onClose()}>
      <DialogContent className="sm:max-w-md rounded-none" showCloseButton={false}>
        <DialogHeader className="pb-4 border-b border-neutral-100">
          <div className="flex items-start gap-4">
            {/* Template thumbnail */}
            {thumbnailUrl && (
              <div className="w-16 h-10 bg-neutral-100 overflow-hidden flex-shrink-0">
                <Image
                  src={thumbnailUrl}
                  alt={templateName}
                  width={64}
                  height={40}
                  className="w-full h-full object-cover"
                />
              </div>
            )}
            <div className="flex-1 min-w-0">
              <DialogTitle className="text-base font-semibold text-neutral-900 truncate">
                Save to Collection
              </DialogTitle>
              <p className="text-sm text-neutral-500 truncate mt-0.5">
                {templateName}
              </p>
            </div>
            <button
              onClick={onClose}
              className="p-1 hover:bg-neutral-100 transition-colors"
            >
              <X className="h-4 w-4 text-neutral-400" />
            </button>
          </div>
        </DialogHeader>

        <div className="py-4">
          {collectionsLoading || isLoadingCollections ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-neutral-400" />
            </div>
          ) : (
            <>
              <ScrollArea className="max-h-64">
                <div className="space-y-1">
                  {collections.map((collection) => {
                    const isInCollection = collection.is_favorites
                      ? isInFavorites(templateId)
                      : templateCollections.some(c => c.id === collection.id)
                    const isLoadingThis = loadingCollectionId === collection.id

                    return (
                      <button
                        key={collection.id}
                        onClick={() => handleToggleCollection(collection)}
                        disabled={isLoadingThis}
                        className={`
                          w-full flex items-center gap-3 px-4 py-3 text-left transition-colors
                          ${isInCollection
                            ? 'bg-neutral-100'
                            : 'hover:bg-neutral-50'
                          }
                        `}
                      >
                        {/* Icon */}
                        <div className={`
                          w-8 h-8 flex items-center justify-center flex-shrink-0
                          ${collection.is_favorites
                            ? isInCollection ? 'bg-red-100 text-red-600' : 'bg-neutral-100 text-neutral-400'
                            : isInCollection ? 'bg-neutral-900 text-white' : 'bg-neutral-100 text-neutral-400'
                          }
                        `}>
                          {isLoadingThis ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : collection.is_favorites ? (
                            <Heart className={`h-4 w-4 ${isInCollection ? 'fill-current' : ''}`} />
                          ) : isInCollection ? (
                            <Check className="h-4 w-4" />
                          ) : (
                            <FolderPlus className="h-4 w-4" />
                          )}
                        </div>

                        {/* Info */}
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-neutral-900 truncate">
                            {collection.name}
                          </p>
                          <p className="text-xs text-neutral-500">
                            {collection.template_count} template{collection.template_count !== 1 ? 's' : ''}
                          </p>
                        </div>

                        {/* Checkbox indicator */}
                        <div className={`
                          w-5 h-5 border-2 flex items-center justify-center flex-shrink-0
                          ${isInCollection
                            ? 'bg-neutral-900 border-neutral-900'
                            : 'border-neutral-300'
                          }
                        `}>
                          {isInCollection && (
                            <Check className="h-3 w-3 text-white" />
                          )}
                        </div>
                      </button>
                    )
                  })}
                </div>
              </ScrollArea>

              {/* Create new collection */}
              <div className="mt-4 pt-4 border-t border-neutral-100">
                {isCreating ? (
                  <form onSubmit={handleCreateCollection} className="space-y-3">
                    <Input
                      placeholder="Collection name"
                      value={newCollectionName}
                      onChange={(e) => setNewCollectionName(e.target.value)}
                      className="rounded-none border-neutral-300 focus:border-neutral-900 focus:ring-0"
                      autoFocus
                      disabled={isSubmitting}
                    />
                    <div className="flex gap-2">
                      <Button
                        type="submit"
                        className="flex-1 rounded-none bg-neutral-900 hover:bg-neutral-800"
                        disabled={!newCollectionName.trim() || isSubmitting}
                      >
                        {isSubmitting ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          'Create & Add'
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
                    </div>
                  </form>
                ) : (
                  <button
                    onClick={() => setIsCreating(true)}
                    className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-neutral-50 transition-colors"
                  >
                    <div className="w-8 h-8 bg-neutral-100 flex items-center justify-center">
                      <FolderPlus className="h-4 w-4 text-neutral-500" />
                    </div>
                    <span className="text-sm font-medium text-neutral-700">
                      Create new collection
                    </span>
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
