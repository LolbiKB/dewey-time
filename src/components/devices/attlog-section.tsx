import type { ReactNode } from 'react'

interface AttlogSectionProps {
  title: string
  description?: string
  icon?: ReactNode
  children: ReactNode
  className?: string
  contentClassName?: string
}

export function AttlogSection({
  title,
  description,
  icon,
  children,
  className,
  contentClassName,
}: AttlogSectionProps) {
  return (
    <section
      className={`rounded-xl border border-border bg-card p-4 sm:p-5 ${className ?? ''}`}
    >
      <div className="mb-4">
        <div className="flex items-center gap-2 text-sm font-medium">
          {icon}
          {title}
        </div>
        {description && (
          <p className="text-xs text-muted-foreground mt-1">{description}</p>
        )}
      </div>
      <div className={contentClassName}>{children}</div>
    </section>
  )
}
