// Reference: presenter and event details, saved only in this browser.
// Any presenter can type their own name, job title, event, date, and an
// optional HTTPS link for their own QR code. Nothing is committed to the repo
// and nothing is sent to the demo's services.
import { useCallback, useState } from 'react'

export const presenterStorageKey = 'demo-presenter'
export const presenterLimits = { name: 80, role: 80, eventName: 100, qrLabel: 40, qrUrl: 300 } as const

export type Presenter = {
  name: string
  role: string
  /** Optional HTTPS link shown as the presenter's own QR code, such as a profile page. */
  qrUrl: string
  /** Short caption, such as "LinkedIn" or "My website". */
  qrLabel: string
  eventName: string
  /** YYYY-MM-DD. Empty means "always show today's date". */
  eventDate: string
}

export const emptyPresenter: Presenter = { name: '', role: '', qrUrl: '', qrLabel: '', eventName: '', eventDate: '' }

const datePattern = /^(\d{4})-(\d{2})-(\d{2})$/

function text(value: unknown, limit: number) {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, limit) : ''
}

/**
 * Accepts only an HTTPS web address without a user name or password.
 * "example.com/me" becomes "https://example.com/me".
 * Returns '' for an empty value and null for anything that is not allowed.
 */
export function normalizePresenterUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed) return ''
  const candidate = /^[a-z][a-z\d+.-]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`
  if (candidate.length > presenterLimits.qrUrl) return null
  try {
    const url = new URL(candidate)
    if (url.protocol !== 'https:' || url.username || url.password || !url.hostname.includes('.')) return null
    return url.href
  } catch {
    return null
  }
}

/** Keeps only real calendar dates, such as 2026-11-05. February 30 is rejected. */
export function validEventDate(value: unknown) {
  if (typeof value !== 'string') return ''
  const match = datePattern.exec(value)
  if (!match) return ''
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
  return date.getMonth() === Number(match[2]) - 1 && date.getDate() === Number(match[3]) ? value : ''
}

/** Checks and trims every field. Unsafe links are dropped. Use it on read, on save, and on every synced message. */
export function cleanPresenter(value: unknown): Presenter {
  const raw = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>
  return {
    name: text(raw.name, presenterLimits.name),
    role: text(raw.role, presenterLimits.role),
    qrUrl: normalizePresenterUrl(raw.qrUrl) ?? '',
    qrLabel: text(raw.qrLabel, presenterLimits.qrLabel),
    eventName: text(raw.eventName, presenterLimits.eventName),
    eventDate: validEventDate(raw.eventDate),
  }
}

export function hasPresenterDetails(presenter: Presenter) {
  return Object.values(presenter).some(Boolean)
}

/** Today's date in the browser's time zone, as YYYY-MM-DD. */
export function todayIso(now = new Date()) {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}

/** The event date in words, such as "November 5, 2026". Uses today when no date is saved. */
export function eventDateLabel(presenter: Pick<Presenter, 'eventDate'>, now = new Date(), locale = 'en-US') {
  const match = datePattern.exec(validEventDate(presenter.eventDate))
  const date = match ? new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3])) : now
  return new Intl.DateTimeFormat(locale, { year: 'numeric', month: 'long', day: 'numeric' }).format(date)
}

export function readPresenter(): Presenter {
  try {
    return cleanPresenter(JSON.parse(localStorage.getItem(presenterStorageKey) ?? 'null'))
  } catch {
    return emptyPresenter
  }
}

export function usePresenter(): [Presenter, (next: Presenter) => void] {
  const [presenter, setPresenter] = useState(readPresenter)
  const save = useCallback((next: Presenter) => {
    const value = cleanPresenter(next)
    try {
      if (hasPresenterDetails(value)) localStorage.setItem(presenterStorageKey, JSON.stringify(value))
      else localStorage.removeItem(presenterStorageKey)
    } catch {
      // Private browsing can block storage. The details still show until the page closes.
    }
    setPresenter(value)
  }, [])
  return [presenter, save]
}
