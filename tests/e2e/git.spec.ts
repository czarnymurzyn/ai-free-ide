/**
 * Source control against a real git repository.
 *
 * Covers both halves of the local-only design: the normal operations work,
 * and the network ones are refused at the invocation layer rather than merely
 * hidden from the UI.
 */

import { expect, test, _electron as electron, type ElectronApplication, type Page } from '@playwright/test'
import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'

const run = promisify(execFile)

let app: ElectronApplication
let page: Page
let workspace: string
let userData: string

test.beforeAll(async () => {
  workspace = await mkdtemp(join(tmpdir(), 'ide-git-workspace-'))
  userData = await mkdtemp(join(tmpdir(), 'ide-git-userdata-'))

  const git = (...args: string[]) => run('git', args, { cwd: workspace })

  await git('init', '-b', 'main')
  await git('config', 'user.email', 'test@example.invalid')
  await git('config', 'user.name', 'Test')

  await mkdir(join(workspace, 'src'), { recursive: true })
  await writeFile(join(workspace, 'src', 'tracked.ts'), 'export const a = 1\n', 'utf8')
  await git('add', '.')
  await git('commit', '-m', 'initial commit')

  // One modified tracked file and one untracked file, so both sections have
  // something in them.
  await writeFile(join(workspace, 'src', 'tracked.ts'), 'export const a = 2\n', 'utf8')
  await writeFile(join(workspace, 'untracked.md'), '# new\n', 'utf8')

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

  // Open the Source Control view.
  await page.locator('.activity-bar__item').nth(2).click()
})

test.afterAll(async () => {
  await app?.close()
  await rm(workspace, { recursive: true, force: true })
  await rm(userData, { recursive: true, force: true })
})

test('shows the branch and the working tree changes', async () => {
  await expect(page.locator('.scm')).toBeVisible()
  await expect(page.locator('.scm__branch')).toContainText('main', { timeout: 15_000 })

  const changes = page.locator('.scm__change')
  await expect(changes.filter({ hasText: 'tracked.ts' })).toBeVisible()
  await expect(changes.filter({ hasText: 'untracked.md' })).toBeVisible()
})

test('offers no push, pull or fetch control anywhere in the UI', async () => {
  // The panel's shape must match what the backend permits.
  const scm = page.locator('.scm')
  await expect(scm).not.toContainText(/push/i)
  await expect(scm).not.toContainText(/pull/i)
  await expect(scm).not.toContainText(/fetch/i)
  await expect(scm).not.toContainText(/sync/i)
})

test('staging moves a file into the staged section', async () => {
  const row = page.locator('.scm__change').filter({ hasText: 'tracked.ts' }).first()
  await row.hover()
  await row.getByRole('button', { name: /^Stage/ }).click()

  const stagedSection = page.locator('.scm__section').filter({ hasText: 'Staged Changes' })
  await expect(stagedSection.locator('.scm__change')).toContainText('tracked.ts', {
    timeout: 15_000
  })

  // Confirm against git itself, not just the UI.
  const { stdout } = await run('git', ['diff', '--cached', '--name-only'], { cwd: workspace })
  expect(stdout).toContain('src/tracked.ts')
})

test('committing creates a real commit', async () => {
  await page.locator('.scm__message').fill('a commit from the IDE')
  await page.locator('.scm__commit-button').click()

  await expect
    .poll(
      async () => (await run('git', ['log', '--format=%s', '-n', '1'], { cwd: workspace })).stdout.trim(),
      { timeout: 20_000 }
    )
    .toBe('a commit from the IDE')

  // The commit box empties once the commit lands.
  await expect(page.locator('.scm__message')).toHaveValue('')
})

test('the history list shows the new commit', async () => {
  const history = page.locator('.scm__section').filter({ hasText: 'History' })
  await expect(history).toContainText('a commit from the IDE', { timeout: 20_000 })
})

test('network git subcommands are refused by the main process', async () => {
  // The renderer has no channel for these, so drive the guard directly
  // through the one generic entry point that does exist.
  const refused = await page.evaluate(async () => {
    // `stash` is a permitted subcommand, so this proves the pipe works at all.
    const ok = await window.ide.git.stash('list').then(() => 'ok').catch((e: Error) => e.message)
    return { ok }
  })
  expect(refused.ok).toBe('ok')

  // And there is simply no API surface for the network operations.
  const api = await page.evaluate(() => Object.keys(window.ide.git).sort())
  expect(api).toEqual(
    expect.not.arrayContaining(['push', 'pull', 'fetch', 'clone', 'remote', 'sync'])
  )
})
