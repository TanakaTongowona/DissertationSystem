import { Progress } from '@/components/ui/progress'
import { cn } from '@/lib/utils'
import { AlertTriangle, CheckCircle, Info } from 'lucide-react'

interface ConfidenceMeterProps {
  score: number
  label?: string
  showIcon?: boolean
  className?: string
}

function getConfidenceLevel(score: number): {
  level: 'high' | 'medium' | 'low'
  color: string
  icon: React.ElementType
  defaultLabel: string
} {
  if (score >= 0.7) {
    return {
      level: 'high',
      color: 'bg-emerald-500',
      icon: CheckCircle,
      defaultLabel: 'High confidence',
    }
  }
  if (score >= 0.4) {
    return {
      level: 'medium',
      color: 'bg-amber-500',
      icon: Info,
      defaultLabel: 'Medium confidence',
    }
  }
  return {
    level: 'low',
    color: 'bg-red-500',
    icon: AlertTriangle,
    defaultLabel: 'Low confidence',
  }
}

export function ConfidenceMeter({ score, label, showIcon = true, className }: ConfidenceMeterProps) {
  const { level, color, icon: Icon, defaultLabel } = getConfidenceLevel(score)
  const displayLabel = label || defaultLabel

  return (
    <div className={cn('space-y-2', className)}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {showIcon && (
            <Icon
              className={cn('h-4 w-4', {
                'text-emerald-500': level === 'high',
                'text-amber-500': level === 'medium',
                'text-red-500': level === 'low',
              })}
            />
          )}
          <span className="text-sm text-muted-foreground">{displayLabel}</span>
        </div>
        <span className="text-sm font-medium">{Math.round(score * 100)}%</span>
      </div>
      <Progress
        value={score * 100}
        className={cn('h-2', {
          '[&>div]:bg-emerald-500': level === 'high',
          '[&>div]:bg-amber-500': level === 'medium',
          '[&>div]:bg-red-500': level === 'low',
        })}
      />
    </div>
  )
}
