/**
 * Git IPC surface.
 *
 * Thin: all the logic lives in ../git/commands.ts, and all the safety lives in
 * ../git/exec.ts. There is deliberately no handler for push, pull or fetch --
 * the channel does not exist, so the UI cannot call one by accident.
 */

import { BrowserWindow, ipcMain } from 'electron'
import { CH, EV, type CommitOptions } from '../../shared/ipc-contract.js'
import * as gitCommands from '../git/commands.js'

export function registerGitHandlers(getWindow: () => BrowserWindow | null): void {
  const notifyChanged = (): void => {
    getWindow()?.webContents.send(EV.gitChanged)
  }

  ipcMain.handle(CH.gitStatus, () => gitCommands.status())
  ipcMain.handle(CH.gitDiff, (_e, path: string, staged: boolean) => gitCommands.diff(path, staged))
  ipcMain.handle(CH.gitHunks, (_e, path: string) => gitCommands.hunks(path))
  ipcMain.handle(CH.gitFileAtHead, (_e, path: string) => gitCommands.fileAtHead(path))
  ipcMain.handle(CH.gitBranches, () => gitCommands.branches())
  ipcMain.handle(CH.gitLog, (_e, limit: number) => gitCommands.log(limit))

  ipcMain.handle(CH.gitStage, async (_e, paths: string[]) => {
    await gitCommands.stage(paths)
    notifyChanged()
  })

  ipcMain.handle(CH.gitUnstage, async (_e, paths: string[]) => {
    await gitCommands.unstage(paths)
    notifyChanged()
  })

  ipcMain.handle(CH.gitDiscard, async (_e, paths: string[]) => {
    await gitCommands.discard(paths)
    notifyChanged()
  })

  ipcMain.handle(CH.gitCommit, async (_e, opts: CommitOptions) => {
    const result = await gitCommands.commit(opts.message, opts.amend, opts.all)
    notifyChanged()
    return result
  })

  ipcMain.handle(CH.gitCheckout, async (_e, name: string) => {
    await gitCommands.checkout(name)
    notifyChanged()
  })

  ipcMain.handle(CH.gitCreateBranch, async (_e, name: string, checkout: boolean) => {
    await gitCommands.createBranch(name, checkout)
    notifyChanged()
  })

  ipcMain.handle(CH.gitStash, async (_e, action: 'push' | 'pop' | 'list') => {
    const output = await gitCommands.stash(action)
    notifyChanged()
    return output
  })
}
