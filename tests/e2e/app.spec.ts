/**
 * End-to-end smoke test against the real, built Electron app.
 *
 * This is the test that proves the pieces are actually wired together: the
 * window opens, the workspace loads, Monaco mounts, an edit reaches disk, and
 * -- most importantly -- the offline guard holds inside a live renderer.
 */

import { expect, test, _electron as electron, type ElectronApplication, type Page } from '@playwright/test'
import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

let app: ElectronApplication
let page: Page
let workspace: string
let userData: string

test.beforeAll(async () => {
  workspace = await mkdtemp(join(tmpdir(), 'ide-e2e-workspace-'))
  userData = await mkdtemp(join(tmpdir(), 'ide-e2e-userdata-'))

  await mkdir(join(workspace, 'src'), { recursive: true })
  await writeFile(join(workspace, 'src', 'hello.ts'), 'export const greeting = "hi"\n', 'utf8')
  await writeFile(join(workspace, 'README.md'), '# Fixture\n', 'utf8')

  // Seed the session so the app restores this workspace on launch, rather
  // than needing a native folder dialog driven from the test.
  await writeFile(
    join(userData, 'session.json'),
    JSON.stringify({
      workspaceRoot: workspace,
      openFiles: [join(workspace, 'src', 'hello.ts')],
      activeFile: join(workspace, 'src', 'hello.ts'),
      secondGroupFiles: [],
      secondGroupActive: null
    }),
    'utf8'
  )

  app = await electron.launch({
    args: ['.', `--user-data-dir=${userData}`],
    cwd: process.cwd()
  })
  page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')
})

test.afterAll(async () => {
  await app?.close()
  await rm(workspace, { recursive: true, force: true })
  await rm(userData, { recursive: true, force: true })
})

test('window opens with the app shell rendered', async () => {
  await expect(page.locator('.app')).toBeVisible()
  await expect(page.locator('.activity-bar')).toBeVisible()
  await expect(page.locator('.status-bar')).toBeVisible()
})

test('the status bar advertises the offline guarantee', async () => {
  await expect(page.locator('.status-bar__item--offline')).toContainText('Offline')
})

test('the workspace loads and the file tree lists it', async () => {
  const tree = page.locator('.file-tree')
  await expect(tree).toBeVisible()
  await expect(tree.getByText('src', { exact: true })).toBeVisible()
  await expect(tree.getByText('README.md', { exact: true })).toBeVisible()
})

test('the restored file opens in Monaco with its content', async () => {
  await expect(page.locator('.monaco-editor').first()).toBeVisible({ timeout: 15_000 })
  await expect(page.locator('.tab--active')).toContainText('hello.ts')
  await expect(page.locator('.monaco-editor').first()).toContainText('greeting')
})

test('typing marks the tab dirty and saving writes to disk', async () => {
  const editor = page.locator('.monaco-editor').first()
  await editor.click()

  // Append a line at the end of the document.
  await page.keyboard.press('Control+End')
  await page.keyboard.type('\nexport const added = 42\n')

  // The close button becomes a dot while there are unsaved changes.
  await expect(page.locator('.tab--active .tab__close--dirty')).toBeVisible()

  await page.keyboard.press('Control+s')

  await expect
    .poll(async () => readFile(join(workspace, 'src', 'hello.ts'), 'utf8'), { timeout: 10_000 })
    .toContain('export const added = 42')

  await expect(page.locator('.tab--active .tab__close--dirty')).toBeHidden()
})

test('the command palette opens and filters', async () => {
  await page.keyboard.press('Control+Shift+P')
  const palette = page.locator('.quick-pick')
  await expect(palette).toBeVisible()

  await page.keyboard.type('toggle term')
  await expect(palette.locator('.quick-pick__item').first()).toContainText('Toggle Terminal')

  await page.keyboard.press('Escape')
  await expect(palette).toBeHidden()
})

test('quick-open lists workspace files', async () => {
  await page.keyboard.press('Control+p')
  const palette = page.locator('.quick-pick')
  await expect(palette).toBeVisible()

  await page.keyboard.type('readme')
  await expect(palette.locator('.quick-pick__item').first()).toContainText('README.md')

  await page.keyboard.press('Enter')
  await expect(page.locator('.tab--active')).toContainText('README.md')
})

test('the integrated terminal starts a real shell', async () => {
  await page.keyboard.press('Control+`')
  await expect(page.locator('.terminal-view')).toBeVisible()

  // xterm renders into a canvas/rows structure; its presence plus a live PTY
  // tab is what tells us node-pty loaded and spawned.
  await expect(page.locator('.terminal-view__tab').first()).toBeVisible({ timeout: 15_000 })
  await expect(page.locator('.terminal-instance .xterm')).toBeVisible()
})

test('the renderer cannot reach the network', async () => {
  // The guarantee, asserted from inside the live renderer rather than from a
  // unit test: every one of these must fail rather than resolve.
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
      http: await attempt(() => fetch('http://example.com/')),
      llmEndpoint: await attempt(() =>
        fetch('https://api.openai.com/v1/chat/completions', { method: 'POST' })
      ),
      websocket: await attempt(
        () =>
          new Promise((resolve, reject) => {
            const socket = new WebSocket('wss://example.com/')
            socket.onopen = () => resolve('open')
            socket.onerror = () => reject(new Error('blocked'))
            setTimeout(() => reject(new Error('timeout')), 3000)
          })
      )
    }
  })

  expect(results.https).not.toBe('RESOLVED')
  expect(results.http).not.toBe('RESOLVED')
  expect(results.llmEndpoint).not.toBe('RESOLVED')
  expect(results.websocket).not.toBe('RESOLVED')
})

test('git operations are refused for network subcommands', async () => {
  // There is no IPC channel for push at all, so the renderer cannot even ask.
  const channels = await page.evaluate(() => Object.keys(window.ide.git))
  expect(channels).not.toContain('push')
  expect(channels).not.toContain('pull')
  expect(channels).not.toContain('fetch')
  expect(channels).toContain('commit')
  expect(channels).toContain('status')
})

test('no AI surface is exposed to the renderer', async () => {
  const surface = await page.evaluate(() => Object.keys(window.ide))
  for (const forbidden of ['ai', 'copilot', 'assistant', 'completion', 'chat', 'model']) {
    expect(surface).not.toContain(forbidden)
  }
})
