'use client'

import { motion } from 'motion/react'
import { cn } from '@/lib/cn'

type From = 'left' | 'right' | 'top' | 'bottom'

export type HighlightVariant = 'ink' | 'lime' | 'forest' | 'charcoal' | 'mint' | 'sky' | 'amber'

interface HighlightedTextProps {
  children: React.ReactNode
  className?: string
  from?: From
  variant?: HighlightVariant
  delay?: number
  inView?: boolean
  once?: boolean
}

const fromVariants = {
  left: {
    hidden: { x: '-100%' },
    visible: { x: '0%' },
  },
  right: {
    hidden: { x: '100%' },
    visible: { x: '0%' },
  },
  top: {
    hidden: { y: '-100%' },
    visible: { y: '0%' },
  },
  bottom: {
    hidden: { y: '100%' },
    visible: { y: '0%' },
  },
}

const variantStyles: Record<
  HighlightVariant,
  { highlight: string; text: string }
> = {
  ink: {
    highlight: 'bg-black dark:bg-white',
    text: 'text-white mix-blend-difference',
  },
  lime: {
    highlight: 'bg-primary-bright',
    text: 'text-primary',
  },
  forest: {
    highlight: 'bg-primary',
    text: 'text-primary-bright',
  },
  charcoal: {
    highlight: 'bg-charcoal',
    text: 'text-primary-bright',
  },
  mint: {
    highlight: 'bg-success-soft',
    text: 'text-[#047857]',
  },
  sky: {
    highlight: 'bg-[#D8F1FF]',
    text: 'text-[#0C5A8F]',
  },
  amber: {
    highlight: 'bg-[#FEF3C7]',
    text: 'text-[#92400E]',
  },
}

export function HighlightedText({
  children,
  className,
  from = 'bottom',
  variant = 'ink',
  delay = 0,
  inView = false,
  once = true,
}: HighlightedTextProps) {
  const variants = fromVariants[from]
  const styles = variantStyles[variant]

  return (
    <motion.span
      className={cn('relative inline-flex overflow-hidden align-baseline', className)}
      initial="hidden"
      whileInView={inView ? 'visible' : undefined}
      animate={inView ? undefined : 'visible'}
      viewport={{ once }}
    >
      <motion.span
        className={cn(
          'absolute inset-0 -left-[0.15em] -right-[0.18em] z-0',
          styles.highlight,
        )}
        variants={variants}
        transition={{
          type: 'spring',
          damping: 30,
          stiffness: 300,
          delay,
        }}
      />
      <span
        className={cn(
          'relative z-10 pl-[0.15em] pr-[0.18em] font-semibold',
          styles.text,
        )}
      >
        {children}
      </span>
    </motion.span>
  )
}

export default HighlightedText
