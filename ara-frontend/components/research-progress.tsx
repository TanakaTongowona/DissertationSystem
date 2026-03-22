"use client"

import { cn } from '@/lib/utils'
import { BookOpen, Brain, Lightbulb, Sparkles, Check, Loader2 } from 'lucide-react'

type Step = 'retrieving' | 'planning' | 'synthesizing' | 'generating'

interface ResearchProgressProps {
  currentStep: Step
  completedSteps: Step[]
  className?: string
}

const steps: { id: Step; label: string; icon: React.ElementType }[] = [
  { id: 'retrieving', label: 'Retrieving relevant books...', icon: BookOpen },
  { id: 'planning', label: 'Creating research plan...', icon: Brain },
  { id: 'synthesizing', label: 'Synthesizing answer...', icon: Lightbulb },
  { id: 'generating', label: 'Generating response...', icon: Sparkles },
]

export function ResearchProgress({ currentStep, completedSteps, className }: ResearchProgressProps) {
  return (
    <div className={cn('space-y-4', className)}>
      {steps.map((step) => {
        const isCompleted = completedSteps.includes(step.id)
        const isCurrent = currentStep === step.id
        const Icon = step.icon

        return (
          <div
            key={step.id}
            className={cn(
              'flex items-center gap-3 p-3 rounded-lg transition-colors',
              isCompleted && 'bg-emerald-50 dark:bg-emerald-900/20',
              isCurrent && 'bg-primary/5 animate-pulse',
              !isCompleted && !isCurrent && 'opacity-50'
            )}
          >
            <div
              className={cn(
                'flex h-8 w-8 items-center justify-center rounded-full',
                isCompleted && 'bg-emerald-500 text-white',
                isCurrent && 'bg-primary text-primary-foreground',
                !isCompleted && !isCurrent && 'bg-muted text-muted-foreground'
              )}
            >
              {isCompleted ? (
                <Check className="h-4 w-4" />
              ) : isCurrent ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Icon className="h-4 w-4" />
              )}
            </div>
            <span
              className={cn(
                'font-medium',
                isCompleted && 'text-emerald-700 dark:text-emerald-300',
                isCurrent && 'text-primary',
                !isCompleted && !isCurrent && 'text-muted-foreground'
              )}
            >
              {step.label}
            </span>
          </div>
        )
      })}
    </div>
  )
}
