// Reference: QR codes drawn locally, never by an outside QR service.
// An outside service would see every link the demo encodes, and it adds a
// network dependency to a live talk. The `qrcode` npm package runs in the
// browser and in Node.js.
import QRCode from 'qrcode'
import { useEffect, useState } from 'react'
import { normalizePresenterUrl } from './presenter-details'

export const qrOptions = {
  errorCorrectionLevel: 'M',
  margin: 2,
  color: { dark: '#231f20ff', light: '#ffffffff' },
} as const

/** An SVG data URL for an HTTPS link, or null while it is being drawn or when the link is not allowed. */
export function useLocalQr(url: string) {
  const [image, setImage] = useState<{ url: string; src: string } | null>(null)
  useEffect(() => {
    const safe = normalizePresenterUrl(url)
    if (!safe) return
    let current = true
    void QRCode.toString(safe, { type: 'svg', ...qrOptions })
      .then((svg) => {
        if (current) setImage({ url, src: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}` })
      })
      .catch(() => {
        if (current) setImage(null)
      })
    return () => { current = false }
  }, [url])
  return image?.url === url ? image.src : null
}
