'use client'

import { useState } from 'react'
import { useAuth } from '@/components/auth/auth-context'
import { SaveToCollectionDialog } from './save-to-collection-dialog'
import { motion } from 'framer-motion'
import { Heart, Loader2 } from 'lucide-react'

interface SaveToCollectionButtonProps {
  templateId: number
  templateName: string
  thumbnailUrl?: string
}

export function SaveToCollectionButton({
  templateId,
  templateName,
  thumbnailUrl
}: SaveToCollectionButtonProps) {
  const { user, isInFavorites, addToFavorites, removeFromFavorites } = useAuth()
  const [isDialogOpen, setIsDialogOpen] = useState(false)
  const [isLoading, setIsLoading] = useState(false)

  const isFavorite = isInFavorites(templateId)

  const handleClick = async (e: React.MouseEvent) => {
    e.stopPropagation()
    e.preventDefault()

    if (!user) {
      // Open dialog which will show sign-in prompt
      setIsDialogOpen(true)
      return
    }

    // Quick toggle for favorites
    setIsLoading(true)
    if (isFavorite) {
      await removeFromFavorites(templateId)
    } else {
      await addToFavorites(templateId)
    }
    setIsLoading(false)
  }

  const handleContextMenu = (e: React.MouseEvent) => {
    e.stopPropagation()
    e.preventDefault()
    setIsDialogOpen(true)
  }

  return (
    <>
      <motion.button
        onClick={handleClick}
        onContextMenu={handleContextMenu}
        whileHover={{ scale: 1.1 }}
        whileTap={{ scale: 0.95 }}
        className={`
          p-2.5 transition-all duration-200
          ${isFavorite
            ? 'bg-red-500 text-white shadow-lg'
            : 'bg-white/90 text-neutral-700 hover:bg-white hover:text-red-500'
          }
        `}
        title={isFavorite ? 'Remove from Favorites (right-click for more options)' : 'Add to Favorites (right-click for more options)'}
        disabled={isLoading}
      >
        {isLoading ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <Heart className={`h-4 w-4 ${isFavorite ? 'fill-current' : ''}`} />
        )}
      </motion.button>

      <SaveToCollectionDialog
        isOpen={isDialogOpen}
        onClose={() => setIsDialogOpen(false)}
        templateId={templateId}
        templateName={templateName}
        thumbnailUrl={thumbnailUrl}
      />
    </>
  )
}
