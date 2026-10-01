// Reference: the presenter console. The presenter's own screen in two-screen mode.
// It opens the toolbar-free Demo Window, shows what the audience sees now and the
// next slide, the speaker notes and a timer, and buttons to show a slide, a page
// of this site, a QR code, or a black screen. Wrap it in your site's header and
// footer, and add the presenter details editor and theme toggle you already use.
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { formatMinutes, paceLabel, slideStartTimes, totalMinutes, type Deck, type Slide } from './deck'
import FitStage from './FitStage'
import type { Presenter } from './presenter-details'
import { Rich } from './rich-text'
import {
  appScreenFor, appScreens, applyCommand, heartbeatMs, isSupported, staleAfterMs, useShowChannel,
  type AppScreen, type ScreenMode, type ShowMessage, type ShowState,
} from './show-sync'

type Props = {
  deck: Deck
  presenter: Presenter
  theme: 'dark' | 'light'
  renderSlide: (index: number, presenter: Presenter) => ReactNode
  renderQr: (presenter: Presenter) => ReactNode
}

type ScreenInfo = { at: number; slide: number; mode: ScreenMode; fullscreen: boolean }
type ScreenArea = { availLeft: number; availTop: number; availWidth: number; availHeight: number }
type ScreenDetails = { screens: ScreenArea[]; currentScreen: ScreenArea }

/** The page of this site that best matches a slide: its first launch link, or the demo for "app" slides. */
export function appScreenForSlide(slide: Slide): AppScreen | null {
  for (const block of slide.blocks) {
    if (block.kind !== 'launch') continue
    for (const link of block.links) {
      const screen = appScreenFor(link.href)
      if (screen) return screen
    }
  }
  return slide.notes.surface === 'app' ? appScreens[0] : null
}

function modeLabel(mode: ScreenMode) {
  switch (mode.kind) {
    case 'slide': return 'Slide'
    case 'qr': return 'QR code'
    case 'black': return 'Paused (black screen)'
    case 'app': return appScreenFor(mode.path)?.label ?? 'Live site'
  }
}

function isTypingTarget(target: EventTarget | null) {
  return target instanceof HTMLElement
    && Boolean(target.closest('input, textarea, select, [contenteditable="true"], dialog'))
}

export default function PresenterConsole({ deck, presenter, theme, renderSlide, renderQr }: Props) {
  const [slide, setSlide] = useState(() => Math.max(0, deck.slides.findIndex((item) => item.id === decodeURIComponent(window.location.hash.slice(1)))))
  const [mode, setMode] = useState<ScreenMode>({ kind: 'slide' })
  const [screenInfo, setScreenInfo] = useState<ScreenInfo | null>(null)
  const [now, setNow] = useState(() => Date.now())
  const [notice, setNotice] = useState('')
  const [elapsed, setElapsed] = useState(0)
  const [running, setRunning] = useState(false)
  // Wait briefly for a running Demo Window before sending state, so a console reload
  // continues from where the audience is instead of jumping back to slide 1.
  const [ready, setReady] = useState(false)
  const touched = useRef(false)
  const readyRef = useRef(false)
  useEffect(() => { readyRef.current = ready }, [ready])
  const demoWindow = useRef<Window | null>(null)
  const starts = slideStartTimes(deck)
  const current = deck.slides[slide]
  const next = deck.slides[slide + 1]
  const suggestedApp = appScreenForSlide(current)
  const connected = screenInfo !== null && now - screenInfo.at < staleAfterMs
  const canPlaceOnScreen = 'getScreenDetails' in window
  const stateRef = useRef<ShowState>({ slide, mode, presenter, theme })
  useEffect(() => { stateRef.current = { slide, mode, presenter, theme } })

  const apply = useCallback((nextState: Pick<ShowState, 'slide' | 'mode'>) => {
    touched.current = true
    setReady(true)
    setSlide(nextState.slide)
    setMode(nextState.mode)
  }, [])

  const postRef = useRef<(message: ShowMessage) => void>(() => undefined)
  const onMessage = useCallback((message: ShowMessage) => {
    if (message.kind === 'hello' && message.source === 'screen') {
      if (readyRef.current) postRef.current({ kind: 'state', source: 'console', state: stateRef.current })
    } else if (message.kind === 'heartbeat') {
      setScreenInfo({ at: Date.now(), slide: message.slide, mode: message.mode, fullscreen: message.fullscreen })
      setNow(Date.now())
      if (!touched.current) {
        touched.current = true
        setSlide(message.slide)
        setMode(message.mode)
      }
      setReady(true)
    } else if (message.kind === 'command') {
      apply(applyCommand(stateRef.current, message.command, deck.slides.length))
    }
  }, [apply, deck.slides.length])
  const post = useShowChannel(deck.id, deck.slides.length, onMessage)
  useEffect(() => { postRef.current = post }, [post])

  useEffect(() => {
    post({ kind: 'hello', source: 'console' })
    const wait = window.setTimeout(() => setReady(true), 800)
    return () => window.clearTimeout(wait)
  }, [post])

  useEffect(() => {
    if (!ready) return
    post({ kind: 'state', source: 'console', state: { slide, mode, presenter, theme } })
    window.history.replaceState(null, '', `${window.location.pathname}#${deck.slides[slide].id}`)
  }, [deck, post, ready, slide, mode, presenter, theme])

  useEffect(() => {
    const interval = window.setInterval(() => {
      if (readyRef.current) post({ kind: 'state', source: 'console', state: stateRef.current })
      setNow(Date.now())
    }, heartbeatMs)
    return () => window.clearInterval(interval)
  }, [post])

  useEffect(() => {
    if (!running) return
    const interval = window.setInterval(() => setElapsed((value) => value + 1), 1000)
    return () => window.clearInterval(interval)
  }, [running])

  const goTo = useCallback((index: number) => {
    apply({ slide: Math.min(deck.slides.length - 1, Math.max(0, index)), mode: { kind: 'slide' } })
  }, [apply, deck.slides.length])

  const show = useCallback((nextMode: ScreenMode) => apply({ slide: stateRef.current.slide, mode: nextMode }), [apply])

  const openDemoWindow = useCallback(async (onOtherScreen = false) => {
    const url = `/presentation/${deck.id}/demo-window#${deck.slides[stateRef.current.slide].id}`
    const width = Math.round(Math.min(1600, window.screen.availWidth * 0.7))
    let area: ScreenArea = { availLeft: window.screenX + 40, availTop: window.screenY + 40, availWidth: width, availHeight: Math.round(width * 9 / 16) }
    if (onOtherScreen && canPlaceOnScreen) {
      try {
        // Window Management API (Edge and Chrome). The browser asks the presenter for permission.
        const details = await (window as unknown as { getScreenDetails: () => Promise<ScreenDetails> }).getScreenDetails()
        area = details.screens.find((item) => item !== details.currentScreen) ?? details.currentScreen
      } catch {
        setNotice('The browser did not allow window placement. The Demo Window opens on this screen instead.')
      }
    }
    const existing = demoWindow.current && !demoWindow.current.closed ? demoWindow.current : null
    if (existing) {
      // Never reload a running Demo Window: that would lose a live chat inside it.
      if (onOtherScreen) {
        existing.moveTo(area.availLeft, area.availTop)
        existing.resizeTo(area.availWidth, area.availHeight)
      }
      existing.focus()
      return
    }
    const features = `popup=yes,left=${area.availLeft},top=${area.availTop},width=${area.availWidth},height=${area.availHeight}`
    // After this page reloads, an empty URL finds the running window by name without reloading it.
    const opened = window.open(connected ? '' : url, `demo-window-${deck.id}`, features)
    if (!opened) {
      setNotice('The browser blocked the Demo Window. Allow pop-ups for this site, then try again.')
      return
    }
    try {
      if (opened.location.href === 'about:blank') opened.location.href = url
    } catch {
      opened.location.href = url
    }
    demoWindow.current = opened
    opened.focus()
    if (!onOtherScreen) setNotice('')
  }, [canPlaceOnScreen, connected, deck])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return
      if (isTypingTarget(event.target)) return
      const onControl = event.target instanceof HTMLElement && Boolean(event.target.closest('a, button'))
      const at = stateRef.current
      switch (event.key) {
        case 'ArrowRight': case 'PageDown': event.preventDefault(); goTo(at.slide + 1); break
        case 'ArrowLeft': case 'PageUp': event.preventDefault(); goTo(at.slide - 1); break
        case ' ':
          if (onControl) return
          event.preventDefault(); goTo(event.shiftKey ? at.slide - 1 : at.slide + 1); break
        case 'Home': event.preventDefault(); goTo(0); break
        case 'End': event.preventDefault(); goTo(deck.slides.length - 1); break
        case 's': case 'S': show({ kind: 'slide' }); break
        case 'b': case 'B': case '.': show(at.mode.kind === 'black' ? { kind: 'slide' } : { kind: 'black' }); break
        case 'q': case 'Q': show({ kind: 'qr' }); break
        case 'd': case 'D': {
          const app = appScreenForSlide(deck.slides[at.slide])
          if (app) show({ kind: 'app', path: app.path })
          break
        }
        case 't': case 'T': setRunning((value) => !value); break
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [deck, goTo, show])

  return (
    <main className="console">
      <header className="console-bar">
        <h1>{deck.title}</h1>
        <span className="console-status" data-connected={connected} role="status">
          {connected ? `Demo Window connected${screenInfo?.fullscreen ? ' · full screen' : ''}` : 'Demo Window not open'}
        </span>
        <button type="button" onClick={() => void openDemoWindow(false)}>
          {connected ? 'Bring Demo Window forward' : 'Open Demo Window'}
        </button>
        {canPlaceOnScreen && <button type="button" onClick={() => void openDemoWindow(true)}>Open on other screen</button>}
        {!isSupported() && <p>This browser cannot link two windows. Use a current version of Edge, Chrome, Firefox, or Safari.</p>}
        {notice && <p role="alert">{notice}</p>}
      </header>

      <section className="console-stage" aria-label="On the Demo Window">
        <div className="console-preview" aria-hidden="true">
          {mode.kind === 'slide' && <FitStage>{renderSlide(slide, presenter)}</FitStage>}
          {mode.kind === 'qr' && <FitStage>{renderQr(presenter)}</FitStage>}
          {mode.kind === 'black' && <p>Black screen. The audience sees nothing.</p>}
          {mode.kind === 'app' && <p>{modeLabel(mode)}: use the live site inside the Demo Window.</p>}
        </div>
        {next && (
          <div className="console-next" aria-hidden="true">
            <FitStage>{renderSlide(slide + 1, presenter)}</FitStage>
          </div>
        )}
        <nav aria-label="Slide controls">
          <button type="button" onClick={() => goTo(slide - 1)} disabled={slide === 0} aria-label="Previous slide">← Prev</button>
          <span aria-live="polite">Slide {slide + 1} of {deck.slides.length}: {current.chip}</span>
          <button type="button" onClick={() => goTo(slide + 1)} disabled={slide === deck.slides.length - 1} aria-label="Next slide">Next →</button>
        </nav>
        <div role="group" aria-label="What the Demo Window shows">
          <button type="button" aria-pressed={mode.kind === 'slide'} onClick={() => show({ kind: 'slide' })}>Slide (S)</button>
          {suggestedApp && (
            <button type="button" aria-pressed={mode.kind === 'app' && mode.path === suggestedApp.path}
              onClick={() => show({ kind: 'app', path: suggestedApp.path })}>
              Show {suggestedApp.label} (D)
            </button>
          )}
          <button type="button" aria-pressed={mode.kind === 'qr'} onClick={() => show({ kind: 'qr' })}>QR code (Q)</button>
          <button type="button" aria-pressed={mode.kind === 'black'} onClick={() => show({ kind: 'black' })}>Black screen (B)</button>
          <label>
            Show a site page
            <select value={mode.kind === 'app' ? mode.path : ''} onChange={(event) => {
              const screen = appScreenFor(event.target.value)
              if (screen) show({ kind: 'app', path: screen.path })
            }}>
              <option value="" disabled>Choose a page…</option>
              {appScreens.map((screen) => <option key={screen.path} value={screen.path}>{screen.label}</option>)}
            </select>
          </label>
          {mode.kind === 'app' && <button type="button" onClick={() => post({ kind: 'reload-app', source: 'console' })}>Reload page</button>}
        </div>
      </section>

      <aside className="console-notes" aria-label="Speaker notes">
        <p>Plan: {formatMinutes(current.notes.minutes)} (from {formatMinutes(starts[slide] ?? 0)} of {formatMinutes(totalMinutes(deck))})</p>
        <div role="group" aria-label="Talk timer">
          <strong>{String(Math.floor(elapsed / 60)).padStart(2, '0')}:{String(elapsed % 60).padStart(2, '0')}</strong>
          <span>{paceLabel(deck, slide, elapsed)}</span>
          <button type="button" onClick={() => setRunning((value) => !value)}>{running ? 'Pause' : 'Start'}</button>
          <button type="button" onClick={() => { setRunning(false); setElapsed(0) }}>Reset</button>
        </div>
        <h2>{current.title}</h2>
        <NotesGroup title="Say" items={current.notes.say} />
        {current.notes.do && <NotesGroup title="Do" items={current.notes.do} ordered />}
        {current.notes.watch && <NotesGroup title="Point out" items={current.notes.watch} />}
        {current.notes.fallback && <NotesGroup title="If it breaks" items={current.notes.fallback} />}
      </aside>

      <nav className="console-strip" aria-label="All slides">
        {deck.slides.map((item, index) => (
          <button key={item.id} type="button" aria-current={index === slide ? 'true' : undefined} onClick={() => goTo(index)}>
            {index + 1}. {item.chip}
          </button>
        ))}
      </nav>
    </main>
  )
}

function NotesGroup({ title, items, ordered = false }: { title: string; items: string[]; ordered?: boolean }) {
  const List = ordered ? 'ol' : 'ul'
  return (
    <section>
      <h3>{title}</h3>
      <List>{items.map((item) => <li key={item}><Rich text={item} /></li>)}</List>
    </section>
  )
}
