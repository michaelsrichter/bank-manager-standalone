// Reference: writes the demo's own QR code at build time.
// Commit the SVG it writes, and add a test that the committed file still
// matches the configured site address. Run again when the address changes:
//   node scripts/build-qr.mjs https://your-demo.example.com/ public/presentation/demo-qr.svg
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import QRCode from 'qrcode'

const [, , siteUrl, outputFile = 'public/presentation/demo-qr.svg'] = process.argv
const url = new URL(siteUrl ?? '')
if (url.protocol !== 'https:') throw new Error('Use the public HTTPS address of the demo site.')

const svg = await QRCode.toString(url.href, {
  type: 'svg',
  errorCorrectionLevel: 'M',
  margin: 2,
  color: { dark: '#231f20ff', light: '#ffffffff' },
})
mkdirSync(path.dirname(outputFile), { recursive: true })
writeFileSync(outputFile, svg)
console.log(`Wrote ${outputFile} for ${url.href}`)
