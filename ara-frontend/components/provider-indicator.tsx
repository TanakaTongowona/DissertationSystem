import { Badge } from '@/components/ui/badge'
import { Server, Cloud, Github, AlertCircle, CheckCircle, XCircle, HelpCircle } from 'lucide-react'
import { cn } from '@/lib/utils'

type Provider = 'ollama' | 'openai' | 'anthropic' | 'github' | string
type Status = 'active' | 'inactive' | 'error'

interface ProviderIndicatorProps {
  provider: string
  status?: Status
  className?: string
  showStatus?: boolean
}

const providerConfig: Record<string, { label: string; icon: React.ElementType; isLocal: boolean }> = {
  ollama: {
    label: 'Ollama',
    icon: Server,
    isLocal: true,
  },
  openai: {
    label: 'OpenAI',
    icon: Cloud,
    isLocal: false,
  },
  anthropic: {
    label: 'Anthropic',
    icon: Cloud,
    isLocal: false,
  },
  github: {
    label: 'GitHub Models',
    icon: Github,
    isLocal: false,
  },
}

const statusConfig: Record<Status, { icon: React.ElementType; className: string }> = {
  active: {
    icon: CheckCircle,
    className: 'text-emerald-500',
  },
  inactive: {
    icon: XCircle,
    className: 'text-gray-400',
  },
  error: {
    icon: AlertCircle,
    className: 'text-red-500',
  },
}

export function ProviderIndicator({ provider, status = 'active', className, showStatus = true }: ProviderIndicatorProps) {
  // Get config with fallback for unknown providers
  const config = providerConfig[provider] || {
    label: provider || 'Unknown Provider',
    icon: HelpCircle,
    isLocal: false,
  }
  
  const statusInfo = statusConfig[status]
  
  // If status is invalid (shouldn't happen with default), use a fallback
  if (!statusInfo) {
    console.warn(`Invalid provider status: ${status}`)
    return null
  }
  
  const Icon = config.icon
  const StatusIcon = statusInfo.icon

  return (
    <Badge
      variant="outline"
      className={cn(
        'gap-1.5 font-medium',
        config.isLocal
          ? 'bg-green-100 text-green-800 dark:bg-green-900/50 dark:text-green-200 border-green-200 dark:border-green-800'
          : 'bg-blue-100 text-blue-800 dark:bg-blue-900/50 dark:text-blue-200 border-blue-200 dark:border-blue-800',
        className
      )}
    >
      <Icon className="h-3 w-3" />
      {config.label}
      {showStatus && <StatusIcon className={cn('h-3 w-3', statusInfo.className)} />}
    </Badge>
  )
}