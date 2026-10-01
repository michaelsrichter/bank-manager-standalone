// Reference: scales a fixed design canvas so a whole slide fits any window,
// like a projector. Lay slides out once at 1600 x 900, then let this scale them.
import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'

type Props = {
  children: ReactNode
  /** Design width in CSS pixels. Content is laid out at this width, then scaled to fit. */
  width?: number
  minHeight?: number
  className?: string
}

export default function FitStage({ children, width = 1600, minHeight = 900, className = '' }: Props) {
  const outer = useRef<HTMLDivElement>(null)
  const inner = useRef<HTMLDivElement>(null)
  const [scale, setScale] = useState(1)

  useLayoutEffect(() => {
    const measure = () => {
      const box = outer.current
      const stage = inner.current
      if (!box || !stage) return
      const height = Math.max(stage.offsetHeight, minHeight)
      const next = Math.min(box.clientWidth / width, box.clientHeight / height)
      setScale(Number.isFinite(next) && next > 0 ? next : 1)
    }
    measure()
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', measure)
      return () => window.removeEventListener('resize', measure)
    }
    const observer = new ResizeObserver(measure)
    if (outer.current) observer.observe(outer.current)
    if (inner.current) observer.observe(inner.current)
    return () => observer.disconnect()
  }, [width, minHeight])

  return (
    <div ref={outer} className={`fit-stage ${className}`}>
      <div
        ref={inner}
        className="fit-stage__inner"
        style={{ width, minHeight, transform: `translate(-50%, -50%) scale(${scale})` }}
      >
        {children}
      </div>
    </div>
  )
}
