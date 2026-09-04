/**
 * Language-server integration, against a real typescript-language-server.
 *
 * The server is discovered from PATH exactly as it would be on a user's
 * machine -- the test just puts the project's own node_modules/.bin on PATH so
 * a server is present to find. Nothing is downloaded at runtime.
 */

import { expect, test, _electron as electron, type ElectronApplication, type Page } from '@playwright/test'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

let app: ElectronApplication
let page: Page
let workspace: string
let userData: string

test.beforeAll(async () => {
  workspace = await mkdtemp(join(tmpdir(), 'ide-lsp-workspace-'))
  userData = await mkdtemp(join(tmpdir(), 'ide-lsp-userdata-'))

  await mkdir(join(workspace, 'src'), { recursive: true })

  await writeFile(
    join(workspace, 'tsconfig.json'),
    JSON.stringify({ compilerOptions: { strict: true, target: 'ES2022', moduleResolution: 'bundler' } }),
    'utf8'
  )

  // A definition to jump to and hover over.
  await writeFile(
    join(workspace, 'src', 'lib.ts'),
    'export function double(value: number): number {\n  return value * 2\n}\n',
    'utf8'
  )

  // A deliberate type error: passing a string where a number is required.
  await writeFile(
    join(workspace, 'src', 'broken.ts'),
    'import { double } from "./lib.js"\n\nexport const wrong = double("not a number")\n',
    'utf8'
  )

  await writeFile(
    join(userData, 'session.json'),
    JSON.stringify({
      workspaceRoot: workspace,
      openFiles: [join(workspace, 'src', 'broken.ts')],
      activeFile: join(workspace, 'src', 'broken.ts'),
      secondGroupFiles: [],
      secondGroupActive: null
    }),
    'utf8'
  )

  app = await electron.launch({
    args: ['.', `--user-data-dir=${userData}`],
    cwd: process.cwd(),
    env: {
      ...process.env,
      // Discovery walks PATH; this makes the locally installed server visible
      // the same way a system-installed one would be.
      PATH: `${join(process.cwd(), 'node_modules', '.bin')}:${process.env.PATH ?? ''}`
    }
  })
  page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')
})

test.afterAll(async () => {
  await app?.close()
  await rm(workspace, { recursive: true, force: true })
  await rm(userData, { recursive: true, force: true })
})

test('discovers typescript-language-server on PATH', async () => {
  // Open the Language Servers view from the activity bar.
  await page.locator('.activity-bar__item').nth(3).click()

  const panel = page.locator('.lsp-panel')
  await expect(panel).toBeVisible()
  await expect(panel).toContainText('TypeScript / JavaScript', { timeout: 15_000 })

  // The resolved binary path is shown, proving it came from PATH.
  await expect(panel.locator('.lsp-server__meta').first()).toContainText(
    'typescript-language-server'
  )
})

test('the server starts and reports running', async () => {
  await expect(page.locator('.lsp-server__dot--running').first()).toBeVisible({ timeout: 45_000 })
  await expect(page.locator('.status-bar')).toContainText('TypeScript / JavaScript', {
    timeout: 20_000
  })
})

test('reports a real type error as a problem', async () => {
  // Open the Problems panel and wait for the server's diagnostics to land.
  await page.keyboard.press('Control+Shift+M')
  const problems = page.locator('.problems')
  await expect(problems).toBeVisible()

  await expect(problems.locator('.problems__row')).not.toHaveCount(0, { timeout: 45_000 })

  // The specific error: string is not assignable to number.
  await expect(problems).toContainText(/not assignable to parameter of type 'number'/, {
    timeout: 20_000
  })
  await expect(problems).toContainText('broken.ts')
})

test('hover shows the signature from the language server', async () => {
  await page.keyboard.press('Control+Shift+M') // close the panel again

  const editor = page.locator('.monaco-editor').first()
  await expect(editor).toBeVisible()

  // Hover the `double` call on the last line.
  const target = editor.getByText('double', { exact: false }).last()
  await target.hover()

  // Monaco keeps two hover widgets in the DOM (content and glyph-margin),
  // both carrying .monaco-hover and both `hidden` until shown -- so match the
  // one that is actually visible rather than the class alone.
  const hover = page.locator('.monaco-hover:not(.hidden)').first()
  await expect(hover).toBeVisible({ timeout: 20_000 })
  await expect(hover).toContainText('double')
})

test('diagnostics clear when the error is fixed', async () => {
  const editor = page.locator('.monaco-editor').first()
  await editor.click()

  // Replace the bad argument with a valid one.
  await page.keyboard.press('Control+a')
  await page.keyboard.type('import { double } from "./lib.js"\n\nexport const right = double(21)\n')
  await page.keyboard.press('Control+s')

  await page.keyboard.press('Control+Shift+M')
  await expect(page.locator('.problems__row')).toHaveCount(0, { timeout: 45_000 })
})
