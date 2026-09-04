/**
 * Project-wide search and replace, driven through ripgrep.
 */

import { expect, test, _electron as electron, type ElectronApplication, type Page } from '@playwright/test'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

let app: ElectronApplication
let page: Page
let workspace: string
let userData: string

test.beforeAll(async () => {
  workspace = await mkdtemp(join(tmpdir(), 'ide-search-workspace-'))
  userData = await mkdtemp(join(tmpdir(), 'ide-search-userdata-'))

  await mkdir(join(workspace, 'src'), { recursive: true })
  await writeFile(join(workspace, 'src', 'a.ts'), 'const needle = 1\nexport { needle }\n', 'utf8')
  await writeFile(join(workspace, 'src', 'b.ts'), '// needle appears here too\n', 'utf8')
  await writeFile(join(workspace, 'src', 'c.ts'), 'const unrelated = 3\n', 'utf8')

  // Must be skipped by the search: this is what .gitignore-awareness buys.
  await mkdir(join(workspace, 'node_modules', 'pkg'), { recursive: true })
  await writeFile(join(workspace, 'node_modules', 'pkg', 'index.js'), 'needle needle\n', 'utf8')

  await writeFile(
    join(userData, 'session.json'),
    JSON.stringify({
      workspaceRoot: workspace,
      openFiles: [],
      activeFile: null,
      secondGroupFiles: [],
      secondGroupActive: null
    }),
    'utf8'
  )

  app = await electron.launch({ args: ['.', `--user-data-dir=${userData}`], cwd: process.cwd() })
  page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')
})

test.afterAll(async () => {
  await app?.close()
  await rm(workspace, { recursive: true, force: true })
  await rm(userData, { recursive: true, force: true })
})

test('finds matches across the workspace', async () => {
  await page.keyboard.press('Control+Shift+F')
  const input = page.locator('[data-search-input]')
  await expect(input).toBeVisible()

  await input.fill('needle')

  const results = page.locator('.search-result')
  await expect(results).toHaveCount(2, { timeout: 20_000 })
  await expect(page.locator('.search-panel__summary')).toContainText('3 results in 2 files')
})

test('skips node_modules', async () => {
  await expect(page.locator('.search-panel__results')).not.toContainText('node_modules')
})

test('clicking a match opens the file at that line', async () => {
  await page.locator('.search-result__match').first().click()

  await expect(page.locator('.tab--active')).toContainText('a.ts', { timeout: 15_000 })
  await expect(page.locator('.monaco-editor').first()).toBeVisible()
})

test('replace rewrites the matches on disk', async () => {
  // Self-contained: re-run the search so this test does not depend on state
  // left behind by the ones above.
  await page.keyboard.press('Control+Shift+F')
  await page.locator('[data-search-input]').fill('needle')
  await expect(page.locator('.search-result')).toHaveCount(2, { timeout: 20_000 })

  await page.locator('.search-panel__toggle-replace').click()
  await page.locator('input[placeholder="Replace"]').fill('haystack')

  // "All" stays disabled until there are results to act on.
  const replaceAll = page.locator('.search-panel__replace-all')
  await expect(replaceAll).toBeEnabled()

  // Confirm the "replace all" dialog rather than letting it block.
  page.once('dialog', (dialog) => void dialog.accept())
  await replaceAll.click()

  // replaceAll writes the files one at a time, so wait for both rather than
  // assuming the second has landed once the first has.
  await expect
    .poll(
      async () => {
        const a = await readFile(join(workspace, 'src', 'a.ts'), 'utf8')
        const b = await readFile(join(workspace, 'src', 'b.ts'), 'utf8')
        return a.includes('haystack') && b.includes('haystack')
      },
      { timeout: 20_000 }
    )
    .toBe(true)

  // The replacement is complete, not partial: no occurrence is left behind.
  const a = await readFile(join(workspace, 'src', 'a.ts'), 'utf8')
  expect(a).not.toContain('needle')

  // An unrelated file must be untouched.
  const c = await readFile(join(workspace, 'src', 'c.ts'), 'utf8')
  expect(c).toBe('const unrelated = 3\n')
})
