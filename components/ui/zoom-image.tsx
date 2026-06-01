'use client'

import { useRef } from 'react'
import { motion, useScroll, useTransform } from 'framer-motion'

interface ZoomImageProps {
  src: string
  alt: string
  className?: string
  zoomStart?: number
  zoomEnd?: number
}

export function ZoomImage({ 
  src, 
  alt, 
  className = '', 
  zoomStart = 1,
  zoomEnd = 1.5 
}: ZoomImageProps) {
  const ref = useRef(null)
  const { scrollYProgress } = useScroll({
    target: ref,
    offset: ["start end", "end start"]
  })
  
  const scale = useTransform(scrollYProgress, [0, 1], [zoomStart, zoomEnd])
  
  return (
    <motion.div ref={ref} style={{ scale }} className={`overflow-hidden ${className}`}>
      <img src={src} alt={alt} className="w-full h-full object-cover" />
    </motion.div>
  )
}