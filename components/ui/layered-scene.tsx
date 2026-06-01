'use client'

import { useRef } from 'react'
import { motion, useScroll, useTransform } from 'framer-motion'

interface LayerProps {
  imageUrl: string
  depth: number
  alt: string
}

interface LayeredSceneProps {
  layers: LayerProps[]
  className?: string
}

export function LayeredScene({ layers, className = '' }: LayeredSceneProps) {
  const ref = useRef(null)
  const { scrollYProgress } = useScroll({
    target: ref,
    offset: ["start end", "end start"]
  })
  
  return (
    <div ref={ref} className={`relative overflow-hidden ${className}`}>
      {layers.map((layer, index) => {
        const y = useTransform(
          scrollYProgress,
          [0, 1],
          [-50 * layer.depth, 50 * layer.depth]
        )
        const scale = useTransform(
          scrollYProgress,
          [0, 1],
          [1 + layer.depth * 0.05, 1 + layer.depth * 0.15]
        )
        
        return (
          <motion.div
            key={index}
            style={{ y, scale }}
            className="absolute inset-0"
            initial={{ scale: 1 + layer.depth * 0.05 }}
          >
            <img 
              src={layer.imageUrl} 
              alt={layer.alt}
              className="w-full h-full object-cover"
            />
          </motion.div>
        )
      })}
      <div className="relative z-10">
        {/* Content goes here */}
      </div>
    </div>
  )
}