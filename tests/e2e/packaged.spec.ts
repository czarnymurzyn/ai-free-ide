/**
 * The offline guarantee in the packaged configuration.
 *
 * The other e2e specs run the app unpackaged, where `app.isPackaged` is false
 * and loopback http is deliberately permitted so the Vite dev server works.
 * This spec drives the real packaged binary, where that exemption is gone and
 * the strict CSP (`connect-src 'none'`) is the one actually served.
 *
 * Skipped unless `npm run pack:dir` has been run.
 */

import { expect, test, _electron as electron, type ElectronApplication, type Page } from '@playwright/test'
import { existsSync } from 'node:fs'
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const BINARY = join(process.cwd(), 'release', 'linux-unpacked', 'ai-free-ide')

let app: ElectronApplication
let page: Page
let workspace: string
let userData: string

test.skip(
  !existsSync(BINARY),
  'packaged binary not built — run `npm run pack:dir` first'
)

test.beforeAll(async () => {
  workspace = await mkdtemp(join(tmpdir(), 'ide-packaged-workspace-'))
  userData = await mkdtemp(join(tmpdir(), 'ide-packaged-userdata-'))

  await mkdir(join(workspace, 'src'), { recursive: true })
  await writeFile(join(workspace, 'src', 'main.ts'), 'export const x = 1\n', 'utf8')
  // Malformed on purpose; used below to prove Monaco's JSON worker is running.
  await writeFile(join(workspace, 'broken.json'), '{ "a": 1,, }\n', 'utf8')
  await writeFile(
    join(userData, 'session.json'),
    JSON.stringify({
      workspaceRoot: workspace,
      openFiles: [join(workspace, 'src', 'main.ts')],
      activeFile: join(workspace, 'src', 'main.ts'),
      secondGroupFiles: [],
      secondGroupActive: null
    }),
    'utf8'
  )

  app = await electron.launch({
    executablePath: BINARY,
    args: [`--user-data-dir=${userData}`, '--no-sandbox']
  })
  page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')
})

test.afterAll(async () => {
  await app?.close()
  await rm(workspace, { recursive: true, force: true })
  await rm(userData, { recursive: true, force: true })
})

test('the packaged app really is packaged', async () => {
  const info = await page.evaluate(() => window.ide.app.info())
  expect(info.offline).toBe(true)
  // Loaded over file://, not from a dev server.
  expect(await page.evaluate(() => location.protocol)).toBe('file:')
})

test('the packaged app renders and opens its workspace', async () => {
  await expect(page.locator('.app')).toBeVisible()
  await expect(page.locator('.monaco-editor').first()).toBeVisible({ timeout: 20_000 })
  await expect(page.locator('.tab--active')).toContainText('main.ts')
})

test('Monaco language workers load from disk and actually run', async () => {
  // The workers are the thing most likely to have been silently pointed at a
  // CDN: if one fails to spawn, the editor degrades to plain highlighting with
  // no visible error. Resource Timing does not record file:// loads, so probe
  // functionally instead -- JSON validation runs in a worker, so a marker on
  // malformed JSON proves the worker started and is doing work.
  await page.keyboard.press('Control+p')
  await page.keyboard.type('broken.json')
  await page.keyboard.press('Enter')

  await expect(page.locator('.tab--active')).toContainText('broken.json', { timeout: 20_000 })

  await page.keyboard.press('Control+Shift+M')
  await expect(page.locator('.problems__row')).not.toHaveCount(0, { timeout: 20_000 })
  await expect(page.locator('.problems')).toContainText(/json/i)

  await page.keyboard.press('Control+Shift+M')
})

test('every outbound request is refused in the packaged build', async () => {
  const results = await page.evaluate(async () => {
    const attempt = async (fn: () => Promise<unknown>): Promise<string> => {
      try {
        await fn()
        return 'RESOLVED'
      } catch (err) {
        return `blocked: ${(err as Error).name}`
      }
    }
    return {
      https: await attempt(() => fetch('https://example.com/')),
      cdn: await attempt(() => fetch('https://cdn.jsdelivr.net/npm/monaco-editor/package.json')),
      fonts: await attempt(() => fetch('https://fonts.googleapis.com/css2?family=Inter')),
      llm: await attempt(() => fetch('https://api.anthropic.com/v1/messages', { method: 'POST' })),
      // Loopback is permitted only while unpackaged; here it must fail too.
      loopback: await attempt(() => fetch('http://127.0.0.1:5173/')),
      xhr: await attempt(
        () =>
          new Promise((resolve, reject) => {
            const xhr = new XMLHttpRequest()
            xhr.open('GET', 'https://example.com/')
            xhr.onload = () => resolve('loaded')
            xhr.onerror = () => reject(new Error('blocked'))
            xhr.send()
          })
      )
    }
  })

  for (const [name, outcome] of Object.entries(results)) {
    expect(outcome, `${name} must be refused`).not.toBe('RESOLVED')
  }
})

test('the strict CSP is the one being served', async () => {
  const csp = await page.evaluate(() => {
    const meta = document.querySelector('meta[http-equiv="Content-Security-Policy"]')
    return meta?.getAttribute('content') ?? ''
  })
  expect(csp).toContain("connect-src 'none'")
  expect(csp).toContain("object-src 'none'")
  expect(csp).toContain("frame-src 'none'")
})
