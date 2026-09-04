/**
 * The offline guarantee.
 *
 * These are the tests that matter most in this project: they assert the
 * central promise rather than an implementation detail. If any of them fail,
 * the app should not ship.
 */

import { describe, expect, it, vi } from 'vitest'

// offline.ts reads app.isPackaged; the rest of the electron surface is not
// touched by the pure predicates under test.
vi.mock('electron', () => ({
  app: { isPackaged: true, commandLine: { appendSwitch: vi.fn() } },
  session: { defaultSession: {} },
  shell: { openExternal: vi.fn() }
}))

const { isRequestAllowed, isLoopbackHttp, describeBlock } = await import('../../src/main/offline.js')

describe('isRequestAllowed', () => {
  it('cancels every outbound network scheme', () => {
    const blocked = [
      'https://example.com/telemetry',
      'http://example.com/',
      'https://registry.npmjs.org/monaco-editor',
      'ws://example.com/socket',
      'wss://api.example.com/stream',
      'ftp://files.example.com/x',
      // A CDN font request, the classic accidental leak in an editor UI.
      'https://fonts.googleapis.com/css2?family=Inter',
      // An LLM endpoint: this IDE must never be able to reach one.
      'https://api.anthropic.com/v1/messages',
      'https://api.openai.com/v1/chat/completions'
    ]
    for (const url of blocked) {
      expect(isRequestAllowed(url), url).toBe(false)
    }
  })

  it('permits the local schemes the app itself needs', () => {
    const allowed = [
      'file:///home/user/project/index.html',
      'file:///home/user/project/assets/editor.worker.js',
      'devtools://devtools/bundled/inspector.html',
      'blob:file:///abc-123',
      'data:text/css;base64,Ym9keXt9',
      'about:blank'
    ]
    for (const url of allowed) {
      expect(isRequestAllowed(url), url).toBe(true)
    }
  })

  it('rejects loopback http in the packaged app', () => {
    // In development the Vite dev server is allowed; once packaged, even
    // localhost is refused, so a stray local service cannot be contacted.
    expect(isRequestAllowed('http://localhost:5173/index.html')).toBe(false)
    expect(isRequestAllowed('http://127.0.0.1:8080/')).toBe(false)
  })

  it('rejects an unparseable url rather than assuming it is safe', () => {
    expect(isRequestAllowed('not a url')).toBe(false)
    expect(isRequestAllowed('')).toBe(false)
  })

  it('is not fooled by a hostname that merely contains a local scheme name', () => {
    expect(isRequestAllowed('https://file.example.com/')).toBe(false)
    expect(isRequestAllowed('https://localhost.evil.com/')).toBe(false)
  })
})

describe('isLoopbackHttp', () => {
  it('recognises the loopback interface only', () => {
    expect(isLoopbackHttp('http://localhost:5173/')).toBe(true)
    expect(isLoopbackHttp('http://127.0.0.1:5173/')).toBe(true)
    expect(isLoopbackHttp('ws://localhost:5173/hmr')).toBe(true)

    expect(isLoopbackHttp('http://192.168.1.10/')).toBe(false)
    expect(isLoopbackHttp('http://localhost.evil.com/')).toBe(false)
    // https to loopback is still not needed by anything the app does.
    expect(isLoopbackHttp('https://localhost:5173/')).toBe(false)
  })
})

describe('describeBlock', () => {
  it('reports the scheme for a diagnostic message', () => {
    expect(describeBlock('https://example.com/x')).toEqual({
      url: 'https://example.com/x',
      scheme: 'https:'
    })
  })

  it('does not throw on an unparseable url', () => {
    expect(describeBlock('¯\\_(ツ)_/¯').scheme).toBe('unknown:')
  })
})
