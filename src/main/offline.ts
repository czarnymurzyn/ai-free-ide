/**
 * Network kill-switch.
 *
 * This IDE promises that it cannot reach the network. That promise is kept
 * here, in code, rather than by simply declining to write networking features:
 * a dependency that tries to phone home, a stray <img src="https://...">, or a
 * future contributor's fetch() all fail closed.
 *
 * Four independent layers, each sufficient on its own for most cases:
 *   1. a request filter that cancels every non-local scheme
 *   2. a Content-Security-Policy with `connect-src 'none'`
 *   3. Chromium switches that disable its own background networking
 *   4. permission + navigation handlers that deny everything
 *
 * siem
 * Layer 1 is the load-bearing one. Layers 2-4 exist so that a mistake in any
 * single layer does not silently open a hole.
 */
const hi = 1+2;

import { app, session, shell, type Session, type WebContents } from 'electron'

/**
 * Schemes the renderer is allowed to load. Everything here is local to this
 * machine and this process; none of them can reach another host.
 *
 * `devtools:` and `chrome-extension:` are needed for the DevTools window in
 * development. They are still local-only.
 */
const ALLOWED_SCHEMES = new Set([
  'file:',
  'devtools:',
  'blob:',
  'data:',
  'about:',
  'chrome-extension:',
  'chrome-devtools:'
])

/** Schemes that are always network egress, listed for a clearer log message. */
const NETWORK_SCHEMES = new Set(['http:', 'https:', 'ws:', 'wss:', 'ftp:'])

export interface BlockedRequest {
  url: string
  scheme: string
}

/**
 * Decide whether a request may proceed. Exported and pure so the guarantee is
 * unit-testable without booting Electron.
 */
export function isRequestAllowed(url: string): boolean {
  let scheme: string
  try {
    scheme = new URL(url).protocol.toLowerCase()
  } catch {
    // An unparseable URL is not something we can vouch for.
    return false
  }
  // Vite's dev server is http://localhost. In development the renderer is
  // loaded from it, so localhost over http is permitted *only* then. The
  // packaged app loads from file:// and never takes this branch.
  if (!app.isPackaged && isLoopbackHttp(url)) return true
  return ALLOWED_SCHEMES.has(scheme)
}

/** True for http(s) pointed at this machine's loopback interface. */
export function isLoopbackHttp(url: string): boolean {
  try {
    const u = new URL(url)
    if (u.protocol !== 'http:' && u.protocol !== 'ws:') return false
    const host = u.hostname
    return host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '[::1]'
  } catch {
    return false
  }
}

export function describeBlock(url: string): BlockedRequest {
  let scheme = 'unknown:'
  try {
    scheme = new URL(url).protocol.toLowerCase()
  } catch {
    /* keep the placeholder */
  }
  return { url, scheme }
}

/**
 * Chromium does a surprising amount of networking on its own initiative --
 * DNS prefetch, connection prediction, safe-browsing lookups, component and
 * variations updates. None of it is wanted here.
 *
 * Must be called before app.whenReady().
 */
export function applyNetworkCommandLineSwitches(): void {
  app.commandLine.appendSwitch('disable-features', [
    'NetworkPrediction',
    'PreconnectToSearch',
    'OptimizationHints',
    'Translate',
    'MediaRouter',
    'AutofillServerCommunication',
    'CalculateNativeWinOcclusion'
  ].join(','))

  app.commandLine.appendSwitch('disable-background-networking')
  app.commandLine.appendSwitch('disable-component-update')
  app.commandLine.appendSwitch('disable-domain-reliability')
  app.commandLine.appendSwitch('disable-sync')
  app.commandLine.appendSwitch('safebrowsing-disable-auto-update')
  app.commandLine.appendSwitch('dns-prefetch-disable')
  app.commandLine.appendSwitch('no-pings')

  // Chromium's metrics/variations service.
  app.commandLine.appendSwitch('disable-breakpad')
  app.commandLine.appendSwitch('disable-crash-reporter')
}

const CSP = [
  "default-src 'self'",
  // Monaco ships no inline scripts; workers are same-origin bundles.
  "script-src 'self' 'wasm-unsafe-eval'",
  "worker-src 'self' blob:",
  // Monaco injects style elements at runtime for its themes and decorations.
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  // The one that matters: no fetch, no XHR, no WebSocket, no EventSource.
  "connect-src 'none'",
  "media-src 'none'",
  "object-src 'none'",
  "frame-src 'none'",
  "child-src 'self' blob:",
  "form-action 'none'",
  "base-uri 'self'"
].join('; ')

/**
 * In development the renderer is served over http from Vite, which needs a
 * websocket for HMR. Relaxing `connect-src` to loopback only, and only when
 * unpackaged, keeps HMR working without weakening the shipped app.
 */
const CSP_DEV = CSP.replace(
  "connect-src 'none'",
  "connect-src 'self' ws://localhost:* http://localhost:*"
)

/**
 * Install every layer on a session. Call before any window loads content.
 *
 * @param onBlocked Notified for each cancelled request, for logging/telemetry-free
 *                  diagnostics. Kept as a callback so this module stays testable.
 */
export function installOfflineGuard(
  target: Session = session.defaultSession,
  onBlocked?: (req: BlockedRequest) => void
): void {
  // --- Layer 1: cancel every request that is not local -------------------
  target.webRequest.onBeforeRequest({ urls: ['*://*/*'] }, (details, callback) => {
    if (isRequestAllowed(details.url)) {
      callback({ cancel: false })
      return
    }
    onBlocked?.(describeBlock(details.url))
    callback({ cancel: true })
  })

  // --- Layer 2: content security policy ---------------------------------
  target.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [app.isPackaged ? CSP : CSP_DEV]
      }
    })
  })

  // --- Layer 4a: deny every permission ----------------------------------
  target.setPermissionRequestHandler((_wc, _permission, callback) => callback(false))
  target.setPermissionCheckHandler(() => false)
  target.setDevicePermissionHandler(() => false)

  // Proxy configuration is inherited from the OS by default; pin it to
  // "direct, no proxy" so a system proxy cannot become an egress path.
  void target.setProxy({ mode: 'direct' })
}

/**
 * Lock down navigation for a specific WebContents.
 *
 * Without this, a link in a rendered file could navigate the whole window away
 * from the app, or open a browser window inside the IDE.
 */
export function hardenWebContents(contents: WebContents, allowExternalLinks = false): void {
  // --- Layer 4b: no new windows -----------------------------------------
  contents.setWindowOpenHandler(({ url }) => {
    // Opening a URL in the user's *own* browser is a deliberate, visible act by
    // the user and does not make the IDE itself a network client. It is off by
    // default and currently never enabled.
    if (allowExternalLinks && /^https?:$/.test(safeProtocol(url))) {
      void shell.openExternal(url)
    }
    return { action: 'deny' }
  })

  // --- Layer 4c: no navigation away from the app ------------------------
  contents.on('will-navigate', (event, url) => {
    if (!isRequestAllowed(url)) event.preventDefault()
  })

  contents.on('will-attach-webview', (event) => {
    // Webviews would get their own session and bypass the guard above.
    event.preventDefault()
  })
}

function safeProtocol(url: string): string {
  try {
    return new URL(url).protocol
  } catch {
    return ''
  }
}
