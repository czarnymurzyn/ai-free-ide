/**
 * The interaction layer: context menu, inline rename, dialogs, breadcrumbs and
 * the git diff view.
 *
 * These replaced window.prompt/window.confirm, so the point of these tests is
 * that the operations still actually happen -- the files on disk and the git
 * state are checked, not just the UI.
 */

import { expect, test, _electron as electron, type ElectronApplication, type Page } from '@playwright/test'
import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'

const run = promisify(execFile)

let app: ElectronApplication
let page: Page
let workspace: string
let userData: string

test.beforeAll(async () => {
  workspace = await mkdtemp(join(tmpdir(), 'ide-ux-workspace-'))
  userData = await mkdtemp(join(tmpdir(), 'ide-ux-userdata-'))

  const git = (...args: string[]) => run('git', args, { cwd: workspace })
  await git('init', '-b', 'main')
  await git('config', 'user.email', 'test@example.invalid')
  await git('config', 'user.name', 'Test')

  await mkdir(join(workspace, 'src'), { recursive: true })
  await writeFile(join(workspace, 'src', 'app.ts'), 'export const version = 1\n', 'utf8')
  await writeFile(join(workspace, 'README.md'), '# Fixture\n', 'utf8')
  await git('add', '.')
  await git('commit', '-m', 'initial')

  // A tracked modification, so there is something to diff.
  await writeFile(join(workspace, 'src', 'app.ts'), 'export const version = 2\n', 'utf8')

  await writeFile(
    join(userData, 'session.json'),
    JSON.stringify({
      workspaceRoot: workspace,
      openFiles: [join(workspace, 'src', 'app.ts')],
      activeFile: join(workspace, 'src', 'app.ts'),
      secondGroupFiles: [],
      secondGroupActive: null
    }),
    'utf8'
  )

  app = await electron.launch({ args: ['.', `--user-data-dir=${userData}`], cwd: process.cwd() })
  page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')
  await expect(page.locator('.file-tree')).toBeVisible()
})

test.afterAll(async () => {
  await app?.close()
  await rm(workspace, { recursive: true, force: true })
  await rm(userData, { recursive: true, force: true })
})

test('right-clicking a file opens a real context menu', async () => {
  await page.locator('.file-tree__row').filter({ hasText: 'README.md' }).click({ button: 'right' })

  const menu = page.locator('.context-menu')
  await expect(menu).toBeVisible()
  // The old UI was a window.prompt asking the user to type "n/d/r/x/v".
  await expect(menu).toContainText('New File')
  await expect(menu).toContainText('Rename')
  await expect(menu).toContainText('Move to Trash')
  await expect(menu).toContainText('Copy Path')

  await page.keyboard.press('Escape')
  await expect(menu).toBeHidden()
})

test('creating a file inline writes it to disk and opens it', async () => {
  await page.locator('.file-tree__toolbar-button').filter({ hasText: 'New File' }).click()

  const input = page.locator('.file-tree__draft-input')
  await expect(input).toBeFocused()
  await input.fill('created.ts')
  await page.keyboard.press('Enter')

  await expect
    .poll(async () => readdir(workspace), { timeout: 15_000 })
    .toContain('created.ts')

  // Creating a file opens it, so you can start typing straight away.
  await expect(page.locator('.tab--active')).toContainText('created.ts')
})

test('an invalid name is rejected without losing what was typed', async () => {
  await page.locator('.file-tree__toolbar-button').filter({ hasText: 'New File' }).click()

  const input = page.locator('.file-tree__draft-input')
  await input.fill('bad/name.ts')
  await expect(input).toHaveAttribute('aria-invalid', 'true')

  // Enter must not commit an invalid name, and must not discard the text.
  await page.keyboard.press('Enter')
  await expect(input).toBeVisible()
  await expect(input).toHaveValue('bad/name.ts')

  await page.keyboard.press('Escape')
  await expect(input).toBeHidden()
})

test('F2 renames a file inline', async () => {
  const row = page.locator('.file-tree__row').filter({ hasText: 'created.ts' }).first()
  await row.click()
  await page.keyboard.press('F2')

  const input = page.locator('.file-tree__draft-input')
  await expect(input).toBeFocused()
  await input.fill('renamed.ts')
  await page.keyboard.press('Enter')

  await expect.poll(async () => readdir(workspace), { timeout: 15_000 }).toContain('renamed.ts')
  expect(await readdir(workspace)).not.toContain('created.ts')
})

test('deleting asks for confirmation in the app, not a browser alert', async () => {
  const row = page.locator('.file-tree__row').filter({ hasText: 'renamed.ts' }).first()
  await row.click({ button: 'right' })
  await page.locator('.context-menu').getByText('Move to Trash').click()

  const dialog = page.locator('.dialog')
  await expect(dialog).toBeVisible()
  await expect(dialog).toContainText('Move "renamed.ts" to the trash?')

  // Cancelling must leave the file alone.
  await dialog.getByRole('button', { name: 'Cancel' }).click()
  await expect(dialog).toBeHidden()
  expect(await readdir(workspace)).toContain('renamed.ts')
})

test('breadcrumbs show where the active file lives', async () => {
  // src/ starts collapsed, so expand it before its children exist as rows.
  await page.locator('.file-tree__row').filter({ hasText: 'src' }).first().click()
  const row = page.locator('.file-tree__row').filter({ hasText: 'app.ts' }).first()
  await expect(row).toBeVisible()
  await row.click()

  const crumbs = page.locator('.breadcrumbs')
  await expect(crumbs).toBeVisible()
  await expect(crumbs).toContainText('src')
  await expect(crumbs).toContainText('app.ts')
})

test('clicking a change in source control opens a diff against HEAD', async () => {
  await page.locator('.activity-bar__item').nth(2).click()
  await page.locator('.scm__change').filter({ hasText: 'app.ts' }).first().click()

  const diff = page.locator('.diff-view')
  await expect(diff).toBeVisible({ timeout: 20_000 })
  await expect(diff).toContainText('HEAD')
  await expect(diff).toContainText('Working Tree')

  // Monaco's diff editor renders both sides.
  await expect(page.locator('.monaco-diff-editor')).toBeVisible({ timeout: 20_000 })
  await expect(page.locator('.tab--active')).toContainText('app.ts (diff)')
})

test('the diff can be switched to inline and back', async () => {
  const toggle = page.locator('.diff-view__toggle')
  await expect(toggle).toContainText('Inline')
  await toggle.click()
  await expect(toggle).toContainText('Side by side')
  await expect(page.locator('.monaco-diff-editor')).toBeVisible()
  await toggle.click()
  await expect(toggle).toContainText('Inline')
})

test('closing the diff returns to the file with its editor intact', async () => {
  await page.locator('.tab--active .tab__close').click()

  // Closing focuses the neighbouring tab, as in any editor; what matters here
  // is that the diff is gone and a real text editor is showing again.
  await expect(page.locator('.diff-view')).toBeHidden()
  await expect(page.locator('.monaco-editor').first()).toBeVisible()
  await expect(page.locator('.tab--active')).not.toContainText('(diff)')

  // The file that was being diffed is still open and still editable.
  await page.locator('.tab').filter({ hasText: 'app.ts' }).first().click()
  await expect(page.locator('.monaco-editor').first()).toContainText('version')
})

test('the tab context menu can close other tabs', async () => {
  // The diff tests left the sidebar on Source Control.
  await page.locator('.activity-bar__item').first().click()
  await page.locator('.file-tree__row').filter({ hasText: 'README.md' }).first().click()
  await expect(page.locator('.tab')).not.toHaveCount(1)

  await page.locator('.tab--active').click({ button: 'right' })
  await page.locator('.context-menu').getByText('Close Others', { exact: true }).click()

  await expect(page.locator('.tab')).toHaveCount(1)
  await expect(page.locator('.tab--active')).toContainText('README.md')
})
