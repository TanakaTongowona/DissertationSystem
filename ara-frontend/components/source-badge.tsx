import { Badge } from '@/components/ui/badge'
import { BookOpen, Globe, Sparkles, HelpCircle, Lightbulb } from 'lucide-react'
import { cn } from '@/lib/utils'

export type SourceType = "library" | "web" | "general" | "none" | "suggestion";

interface SourceBadgeProps {
  type: SourceType
  className?: string
}

const sourceConfig: Record<SourceType, { label: string; icon: React.ElementType; className: string }> = {
  library: {
    label: 'Library',
    icon: BookOpen,
    className: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-200 border-emerald-200 dark:border-emerald-800',
  },
  web: {
    label: 'Web',
    icon: Globe,
    className: 'bg-blue-100 text-blue-800 dark:bg-blue-900/50 dark:text-blue-200 border-blue-200 dark:border-blue-800',
  },
  general: {
    label: 'General Knowledge',
    icon: Sparkles,
    className: 'bg-amber-100 text-amber-800 dark:bg-amber-900/50 dark:text-amber-200 border-amber-200 dark:border-amber-800',
  },
   suggestion: {
      icon: Lightbulb,
      label: "Suggestion",
      className: 'bg-blue-100 text-blue-800 dark:bg-blue-900/50 dark:text-blue-200 border-blue-200 dark:border-blue-800',
      
    },
  none: {
    label: 'No Sources',
    icon: HelpCircle,
    className: 'bg-gray-100 text-gray-800 dark:bg-gray-800/50 dark:text-gray-200 border-gray-200 dark:border-gray-700',
  },
}

export function SourceBadge({ type, className }: SourceBadgeProps) {
  const config = sourceConfig[type]
  
  // If type is invalid, return null (component won't render)
  if (!config) {
    console.warn(`Invalid source type: ${type}`)
    return null
  }
  
  const Icon = config.icon

  return (
    <Badge variant="outline" className={cn('gap-1 font-medium', config.className, className)}>
      <Icon className="h-3 w-3" />
      {config.label}
    </Badge>
  )
}