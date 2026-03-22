"use client"

import { Book, FileText, RefreshCw, Trash2, Eye, Edit, MoreVertical } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'

interface BookCardProps {
  id?: string
  title: string
  author: string
  indexed: boolean
  fileSize?: number
  similarity?: number
  datePublished?: string | null
  onView?: () => void
  onReindex?: () => void
  onUpdate?: () => void
  onDelete?: () => void
  variant?: 'grid' | 'list'
  isSuperuser?: boolean
}

function formatFileSize(bytes?: number): string {
  if (!bytes) return 'Unknown'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function formatDate(dateString?: string | null): string {
  if (!dateString) return ''
  return new Date(dateString).toLocaleDateString()
}

export function BookCard({
  id,
  title,
  author,
  indexed,
  fileSize,
  similarity,
  datePublished,
  onView,
  onReindex,
  onUpdate,
  onDelete,
  variant = 'grid',
  isSuperuser = false,
}: BookCardProps) {
  const ActionButton = ({ onClick, icon: Icon, label, btnVariant = "ghost", className = "" }: any) => (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant={btnVariant}
            size="icon"
            onClick={onClick}
            className={`h-8 w-8 ${className}`}
          >
            <Icon className="h-4 w-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          <p>{label}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )

  const ActionsDropdown = () => (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="h-8 w-8">
          <MoreVertical className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        <DropdownMenuLabel>Actions</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {onView && (
          <DropdownMenuItem onClick={onView}>
            <Eye className="h-4 w-4 mr-2" />
            View Details
          </DropdownMenuItem>
        )}
        {onReindex && (
          <DropdownMenuItem onClick={onReindex}>
            <RefreshCw className="h-4 w-4 mr-2" />
            Reindex
          </DropdownMenuItem>
        )}
        {isSuperuser && onUpdate && (
          <DropdownMenuItem onClick={onUpdate}>
            <Edit className="h-4 w-4 mr-2" />
            Edit Metadata
          </DropdownMenuItem>
        )}
        {isSuperuser && onDelete && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem 
              onClick={onDelete}
              className="text-destructive focus:text-destructive"
            >
              <Trash2 className="h-4 w-4 mr-2" />
              Delete
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )

  if (variant === 'list') {
    return (
      <div className="flex items-center gap-4 p-4 border border-border rounded-lg bg-card hover:shadow-md transition-all duration-200 group">
        <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-primary/10 group-hover:bg-primary/20 transition-colors">
          <FileText className="h-6 w-6 text-primary" />
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="font-medium text-card-foreground truncate">{title}</h3>
          <p className="text-sm text-muted-foreground truncate">{author}</p>
          {datePublished && (
            <p className="text-xs text-muted-foreground mt-1">
              Published: {formatDate(datePublished)}
            </p>
          )}
        </div>
        <div className="flex items-center gap-3">
          <Badge 
            variant={indexed ? 'default' : 'secondary'} 
            className={`${indexed ? 'bg-accent text-accent-foreground' : ''} px-3 py-1`}
          >
            {indexed ? 'Indexed' : 'Pending'}
          </Badge>
          <span className="text-sm text-muted-foreground font-medium">
            {formatFileSize(fileSize)}
          </span>
        </div>
        <div className="flex items-center gap-1">
          {onView && (
            <ActionButton onClick={onView} icon={Eye} label="View Details" />
          )}
          {onReindex && (
            <ActionButton onClick={onReindex} icon={RefreshCw} label="Reindex" />
          )}
          <ActionsDropdown />
        </div>
      </div>
    )
  }

  return (
    <Card className="group hover:shadow-lg transition-all duration-200 border-border relative cursor-pointer" onClick={onView}>
      <CardContent className="pt-6">
        <div className="flex flex-col items-center text-center">
          <div className="absolute top-2 right-2" onClick={(e) => e.stopPropagation()}>
            <ActionsDropdown />
          </div>
          <div className="flex h-20 w-20 items-center justify-center rounded-xl bg-gradient-to-br from-primary/10 to-primary/5 mb-4 group-hover:from-primary/20 group-hover:to-primary/10 transition-all duration-200">
            <Book className="h-10 w-10 text-primary" />
          </div>
          <h3 className="font-semibold text-card-foreground line-clamp-2 mb-1 px-2">
            {title}
          </h3>
          <p className="text-sm text-muted-foreground line-clamp-1 mb-3">{author}</p>
          {datePublished && (
            <p className="text-xs text-muted-foreground mb-2">
              {formatDate(datePublished)}
            </p>
          )}
          <div className="flex items-center gap-2 mb-2">
            <Badge 
              variant={indexed ? 'default' : 'secondary'} 
              className={`${indexed ? 'bg-accent text-accent-foreground' : ''} px-3 py-1`}
            >
              {indexed ? 'Indexed' : 'Pending'}
            </Badge>
          </div>
          <span className="text-xs text-muted-foreground font-medium">
            {formatFileSize(fileSize)}
          </span>
          {similarity !== undefined && (
            <div className="w-full mt-4 px-2">
              <div className="flex justify-between text-xs text-muted-foreground mb-1">
                <span>Relevance</span>
                <span className="font-medium">{Math.round(similarity * 100)}%</span>
              </div>
              <Progress value={similarity * 100} className="h-2" />
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  )
}