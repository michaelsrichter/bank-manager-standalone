// Reference: the Demo Window, the audience screen in two-screen mode.
// It has no site header, footer, or menus. It shows only what the presenter
// console sends: a slide, a page of this site, a large QR code, or a black screen.
// A clicker or keyboard in this window still works. When the console is
// connected, keys are sent to it so the console stays in charge.
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import type { Deck } from './deck'
import FitStage from './FitStage'
import { readPresenter, type Presenter } from './presenter-details'
import {
  appScreenFor, applyCommand, commandForKey, heartbeatMs, staleAfterMs, useShowChannel,
  type ScreenCommand, type ShowMessage, type ShowState,
} from './show-sync'

type Props = {
  deck: Deck
  /** Renders one slide at the 1600 x 900 design size. */
  renderSlide: (index: number, presenter: Presenter) => ReactNode
  /** Renders the QR screen: the demo QR code, plus the presenter's when one is saved. */
  renderQr: (presenter: Presenter) => ReactNode
}

function initialState(deck: Deck): ShowState {
  const id = decodeURIComponent(window.location.hash.slice(1))
  return {
    slide: Math.max(0, deck.slides.findIndex((slide) => slide.id === id)),
    mode: { kind: 'slide' },
    presenter: readPresenter(),
    theme: document.documentElement.dataset.theme === 'light' ? 'light' : 'dark',
  }
}

function toggleFullscreen() {
  if (document.fullscreenElement) void document.exitFullscreen?.()
  else void document.documentElement.requestFullscreen?.()
}

export default function DemoWindow({ deck, renderSlide, renderQr }: Props) {
  const [state, setState] = useState<ShowState>(() => initialState(deck))
  const [lastConsole, setLastConsole] = useState(0)
  const [now, setNow] = useState(() => Date.now())
  const [fullscreen, setFullscreen] = useState(false)
  const [controlsVisible, setControlsVisible] = useState(true)
  // Site pages stay loaded after their first use, so a live chat survives a trip back to the slides.
  const [appFrames, setAppFrames] = useState<Record<string, number>>({})
  const hideTimer = useRef<number | undefined>(undefined)
  const stateRef = useRef(state)
  useEffect(() => { stateRef.current = state }, [state])

  const consoleConnected = lastConsole > 0 && now - lastConsole < staleAfterMs

  const heartbeatRef = useRef<() => void>(() => undefined)
  const onMessage = useCallback((message: ShowMessage) => {
    if (message.kind === 'state') {
      setState(message.state)
      setLastConsole(Date.now())
      const mode = message.state.mode
      if (mode.kind === 'app') setAppFrames((frames) => (mode.path in frames ? frames : { ...frames, [mode.path]: 0 }))
    } else if (message.kind === 'hello' && message.source === 'console') {
      setLastConsole(Date.now())
      heartbeatRef.current()
    } else if (message.kind === 'reload-app') {
      const mode = stateRef.current.mode
      if (mode.kind === 'app') setAppFrames((frames) => ({ ...frames, [mode.path]: (frames[mode.path] ?? 0) + 1 }))
    }
  }, [])
  const post = useShowChannel(deck.id, deck.slides.length, onMessage)

  const sendHeartbeat = useCallback(() => {
    post({
      kind: 'heartbeat', source: 'screen', slide: stateRef.current.slide, mode: stateRef.current.mode,
      fullscreen: Boolean(document.fullscreenElement),
    })
  }, [post])
  useEffect(() => { heartbeatRef.current = sendHeartbeat }, [sendHeartbeat])

  useEffect(() => {
    document.title = `Demo Window · ${deck.slides[state.slide].chip}`
  }, [deck, state.slide])

  useEffect(() => {
    document.documentElement.dataset.theme = state.theme
  }, [state.theme])

  useEffect(() => {
    post({ kind: 'hello', source: 'screen' })
    sendHeartbeat()
    const interval = window.setInterval(() => {
      sendHeartbeat()
      setNow(Date.now())
    }, heartbeatMs)
    return () => window.clearInterval(interval)
  }, [post, sendHeartbeat])

  useEffect(() => { sendHeartbeat() }, [state, sendHeartbeat])

  const runCommand = useCallback((command: ScreenCommand) => {
    if (consoleConnected) post({ kind: 'command', source: 'screen', command })
    else setState((current) => applyCommand(current, command, deck.slides.length))
  }, [consoleConnected, deck.slides.length, post])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.altKey || event.ctrlKey || event.metaKey) return
      if (event.key === 'f' || event.key === 'F') {
        toggleFullscreen()
        return
      }
      const command = commandForKey(event.key)
      if (!command) return
      event.preventDefault()
      runCommand(command)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [runCommand])

  useEffect(() => {
    const onChange = () => {
      setFullscreen(Boolean(document.fullscreenElement))
      sendHeartbeat()
    }
    document.addEventListener('fullscreenchange', onChange)
    return () => document.removeEventListener('fullscreenchange', onChange)
  }, [sendHeartbeat])

  const revealControls = useCallback(() => {
    setControlsVisible(true)
    window.clearTimeout(hideTimer.current)
    hideTimer.current = window.setTimeout(() => setControlsVisible(false), 2500)
  }, [])

  useEffect(() => {
    hideTimer.current = window.setTimeout(() => setControlsVisible(false), 4000)
    return () => window.clearTimeout(hideTimer.current)
  }, [])

  const mode = state.mode

  return (
    <div
      className="screen-shell"
      data-mode={mode.kind}
      data-controls={controlsVisible ? 'visible' : 'hidden'}
      onPointerMove={revealControls}
    >
      <main className="screen-main" aria-label="Demo Window" aria-live="polite">
        {mode.kind === 'slide' && (
          <FitStage className="screen-stage" key={state.slide}>{renderSlide(state.slide, state.presenter)}</FitStage>
        )}
        {mode.kind === 'qr' && <FitStage className="screen-stage">{renderQr(state.presenter)}</FitStage>}
        {mode.kind === 'black' && <p className="screen-black">The presenter paused the screen.</p>}
        {Object.entries(appFrames).map(([path, version]) => {
          const screen = appScreenFor(path)
          if (!screen) return null
          const active = mode.kind === 'app' && mode.path === path
          return (
            <iframe
              key={`${path}:${version}`}
              src={screen.path}
              title={`${screen.label} (live site)`}
              className="screen-app"
              hidden={!active}
              aria-hidden={!active}
            />
          )
        })}
      </main>

      <p className="screen-badge">For demo purposes only</p>

      {!fullscreen && (
        <div className="screen-controls" role="group" aria-label="Demo Window controls">
          <button type="button" onClick={toggleFullscreen}>Full screen (F)</button>
          {!consoleConnected && <span>Presenter console not connected. Use → and ← here, or open the console.</span>}
        </div>
      )}
    </div>
  )
}
