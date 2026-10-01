// Reference: the content model for talks. Copy into the frontend and adapt.
// Slides and speaker notes are typed data, not Markdown or HTML, so the same
// content can drive the slides page, the printable script, the presenter
// console, and the Demo Window without any HTML injection.

/** Where the presenter's screen should be while a slide is discussed. */
export type Surface = 'slides' | 'app' | 'azure' | 'foundry' | 'observability'

export type Tone = 'accent' | 'info' | 'warning' | 'success' | 'danger'

export type Card = { icon?: string; title: string; text: string; tone?: Tone }

/** Text fields may use **double stars** for bold. Nothing else is interpreted. */
export type SlideBlock =
  | { kind: 'lead'; text: string }
  | { kind: 'cards'; items: Card[]; columns?: 2 | 3 | 4 }
  | { kind: 'steps'; items: { title: string; text: string }[] }
  | { kind: 'bullets'; items: string[] }
  | { kind: 'quote'; text: string }
  | { kind: 'chain'; label: string; items: string[] }
  | {
    kind: 'compare'
    left: { title: string; items: string[]; tone?: Tone }
    right: { title: string; items: string[]; tone?: Tone }
  }
  | { kind: 'table'; caption: string; headers: string[]; rows: string[][] }
  | { kind: 'image'; src: string; alt: string; caption: string }
  | { kind: 'code'; caption: string; code: string }
  | { kind: 'launch'; text?: string; links: { label: string; href: string }[] }
  | { kind: 'timeline'; items: { when: string; title: string; text: string }[] }
  /** An honest "In this demo" callout for anything the demo does not do yet. */
  | { kind: 'honest'; text: string }
  /** The demo QR code, plus the presenter's QR code when one is saved. */
  | { kind: 'qr' }

export type SpeakerNotes = {
  /** Planned speaking time for this slide, in minutes. */
  minutes: number
  surface: Surface
  /** What to say. Short lines the presenter can glance at. */
  say: string[]
  /** What to click, in order. Use the exact labels the UI shows. */
  do?: string[]
  /** What the audience should notice. */
  watch?: string[]
  /** What to do if a live step fails, including the Practice fallback. */
  fallback?: string[]
}

export type Slide = {
  /** Stable, URL-safe ID. Used in #hash links and the presenter console. */
  id: string
  /** Short label for the slide strip and the pager. */
  chip: string
  section?: string
  eyebrow?: string
  title: string
  blocks: SlideBlock[]
  notes: SpeakerNotes
}

export type Deck = {
  /** URL segment, such as "lightning" or "one-hour". */
  id: string
  title: string
  /** The format line above the title, such as "Lightning talk". */
  kicker: string
  subtitle: string
  /** Human label, such as "15-minute". */
  lengthLabel: string
  targetMinutes: number
  summary: string
  audience: string
  /** The presenter's get-ready checklist. */
  prep: string[]
  slides: Slide[]
}

export function slideStartTimes(deck: Deck) {
  let elapsed = 0
  return deck.slides.map((slide) => {
    const start = elapsed
    elapsed += slide.notes.minutes
    return start
  })
}

export function totalMinutes(deck: Deck) {
  return deck.slides.reduce((sum, slide) => sum + slide.notes.minutes, 0)
}

/** 1.5 becomes "1:30". */
export function formatMinutes(minutes: number) {
  const whole = Math.floor(minutes)
  const seconds = Math.round((minutes - whole) * 60)
  return `${whole}:${String(seconds).padStart(2, '0')}`
}

/** "Behind by 1:30", "Ahead by 0:45", or "On time", compared with the plan for this slide. */
export function paceLabel(deck: Deck, slideIndex: number, elapsedSeconds: number) {
  if (elapsedSeconds === 0) return 'Timer not started'
  const start = slideStartTimes(deck)[slideIndex] ?? 0
  const end = start + (deck.slides[slideIndex]?.notes.minutes ?? 0)
  const elapsed = elapsedSeconds / 60
  if (elapsed > end + 0.5) return `Behind by ${formatMinutes(elapsed - end)}`
  if (elapsed < start - 0.5) return `Ahead by ${formatMinutes(start - elapsed)}`
  return 'On time'
}
