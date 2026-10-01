// Reference tests for show-sync.ts and presenter-details.ts. Adapt to your test runner (Vitest shown).
import { describe, expect, it } from 'vitest'
import { cleanPresenter, emptyPresenter, eventDateLabel, normalizePresenterUrl, validEventDate } from './presenter-details'
import { applyCommand, commandForKey, parseShowMessage, type ShowState } from './show-sync'

const baseState: ShowState = { slide: 0, mode: { kind: 'slide' }, presenter: emptyPresenter, theme: 'dark' }

describe('two-screen messages', () => {
  it('accepts only known messages, real slides, and allow-listed site pages', () => {
    const state = { kind: 'state', source: 'console', state: { ...baseState, slide: 3 } }
    expect(parseShowMessage(state, 12)).toEqual(state)
    expect(parseShowMessage({ ...state, state: { ...baseState, slide: 12 } }, 12)).toBeNull()
    expect(parseShowMessage({ ...state, state: { ...baseState, slide: 1.5 } }, 12)).toBeNull()
    for (const path of ['https://example.com', '//example.com', 'javascript:alert(1)', '/demo/../admin']) {
      expect(parseShowMessage({ ...state, state: { ...baseState, mode: { kind: 'app', path } } }, 12), path).toBeNull()
    }
    expect(parseShowMessage({ ...state, state: { ...baseState, mode: { kind: 'app', path: '/demo' } } }, 12)).not.toBeNull()
    expect(parseShowMessage({ kind: 'command', source: 'screen', command: 'delete-everything' }, 12)).toBeNull()
    expect(parseShowMessage({ kind: 'state', source: 'screen', state }, 12)).toBeNull()
    expect(parseShowMessage('hello', 12)).toBeNull()
  })

  it('cleans presenter details inside every state message', () => {
    const message = parseShowMessage({
      kind: 'state', source: 'console',
      state: { ...baseState, presenter: { name: 'x'.repeat(200), role: 4, qrUrl: 'javascript:alert(1)', eventDate: '2026-02-30' } },
    }, 12)
    expect(message?.kind === 'state' && message.state.presenter).toEqual({ ...emptyPresenter, name: 'x'.repeat(80) })
  })

  it('maps keyboard and clicker keys to safe commands', () => {
    expect(commandForKey('PageDown')).toBe('next')
    expect(commandForKey('ArrowLeft')).toBe('prev')
    expect(commandForKey('.')).toBe('toggle-black')
    expect(commandForKey('x')).toBeNull()
    expect(applyCommand({ ...baseState, slide: 11 }, 'next', 12).slide).toBe(11)
    expect(applyCommand(baseState, 'prev', 12).slide).toBe(0)
    expect(applyCommand({ ...baseState, mode: { kind: 'app', path: '/demo' } }, 'next', 12)).toMatchObject({ slide: 1, mode: { kind: 'slide' } })
  })
})

describe('presenter details', () => {
  it('accepts only https links and real dates', () => {
    expect(normalizePresenterUrl('example.com/me')).toBe('https://example.com/me')
    expect(normalizePresenterUrl('')).toBe('')
    for (const bad of ['http://example.com', 'javascript:alert(1)', 'https://user:pw@example.com', 'https://localhost', `https://example.com/${'x'.repeat(400)}`]) {
      expect(normalizePresenterUrl(bad), bad).toBeNull()
    }
    expect(validEventDate('2026-11-05')).toBe('2026-11-05')
    expect(validEventDate('2026-02-30')).toBe('')
    expect(eventDateLabel({ eventDate: '2026-11-05' })).toBe('November 5, 2026')
    expect(eventDateLabel({ eventDate: '' }, new Date(2026, 8, 30))).toBe('September 30, 2026')
    expect(cleanPresenter({ qrUrl: 'javascript:alert(1)', eventName: 'x'.repeat(200) })).toEqual({ ...emptyPresenter, eventName: 'x'.repeat(100) })
  })
})
