'use client'

import { motion } from 'framer-motion'

interface CinematicContainerProps {
  children: React.ReactNode
  delay?: number
  duration?: number
  className?: string
}

export function CinematicContainer({ 
  children, 
  delay = 0, 
  duration = 0.8,
  className = '' 
}: CinematicContainerProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 100 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-100px" }}
      transition={{ 
        duration, 
        delay, 
        ease: [0.25, 0.1, 0.25, 1]
      }}
      className={className}
    >
      {children}
    </motion.div>
  )
}