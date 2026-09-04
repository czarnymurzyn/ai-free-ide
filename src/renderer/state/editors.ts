/**
 * Open editors, tabs and editor groups.
 *
 * Monaco text models are the source of truth for file content while a file is
 * open: the model holds the text, the undo stack and the cursor. This store
 * holds everything *around* the model (which tab is active, whether it is
 * dirty, the mtime it was read at) and keeps a model per path in a side map
 * so switching tabs preserves undo history and scroll position.
 */

import * as monaco from 'monaco-editor'
import { create } from 'zustand'
import { languageIdFor } from '@shared/languages.js'
import { confirmDialog } from './dialogs.js'

export type GroupId = 'primary' | 'secondary'

export interface OpenFile {
  /** Tab identity. For a diff this is `diff:<absolute path>`, not the path. */
  path: string
  name: string
  languageId: string
  dirty: boolean
  /** mtime when last read or written; used to detect out-of-band edits. */
  mtimeMs: number
  eol: '\n' | '\r\n'
  /** Incremented on every change, sent to the language server. */
  version: number
  readOnly: boolean
  /** A normal editor tab, or a diff against HEAD. */
  kind: 'file' | 'diff'
  /** The file on disk. Differs from `path` only for diff tabs. */
  sourcePath: string
}

/**
 * Diff tabs share the tab strip with file tabs, so they need an identity that
 * cannot collide with a real path -- otherwise opening a diff would steal the
 * tab of the file it is diffing.
 */
const DIFF_PREFIX = 'diff:'

export const diffTabId = (path: string): string => `${DIFF_PREFIX}${path}`
export const isDiffTab = (tabId: string): boolean => tabId.startsWith(DIFF_PREFIX)
export const diffSourceOf = (tabId: string): string => tabId.slice(DIFF_PREFIX.length)

interface EditorState {
  files: Map<string, OpenFile>
  groups: Record<GroupId, string[]>
  active: Record<GroupId, string | null>
  activeGroup: GroupId
  splitVisible: boolean
  /** Saved view state per path, so scroll and cursor survive a tab switch. */
  viewState: Map<string, monaco.editor.ICodeEditorViewState>

  openFile(path: string, group?: GroupId, preview?: boolean): Promise<void>
  openDiff(path: string, group?: GroupId): void
  closeFile(path: string, group: GroupId): Promise<void>
  closeAll(group?: GroupId): Promise<void>
  setActive(path: string, group: GroupId): void
  setActiveGroup(group: GroupId): void
  toggleSplit(): void
  markDirty(path: string, dirty: boolean): void
  save(path?: string): Promise<void>
  saveAll(): Promise<void>
  saveAs(path: string): Promise<void>
  reloadFromDisk(path: string): Promise<void>
  bumpVersion(path: string): number
  saveViewState(path: string, state: monaco.editor.ICodeEditorViewState | null): void
}

/** Model per absolute path, kept outside the store so React never diffs it. */
const models = new Map<string, monaco.editor.ITextModel>()

export function getModel(path: string): monaco.editor.ITextModel | undefined {
  return models.get(path)
}

export const useEditors = create<EditorState>((set, get) => ({
  files: new Map(),
  groups: { primary: [], secondary: [] },
  active: { primary: null, secondary: null },
  activeGroup: 'primary',
  splitVisible: false,
  viewState: new Map(),

  async openFile(path, group, _preview) {
    const targetGroup = group ?? get().activeGroup

    // Already open in this group: just focus it.
    if (get().groups[targetGroup].includes(path)) {
      get().setActive(path, targetGroup)
      return
    }

    // Open elsewhere: reuse the loaded model, just add a tab.
    if (!models.has(path)) {
      const content = await window.ide.fs.read(path)
      const uri = monaco.Uri.file(content.path)
      const existing = monaco.editor.getModel(uri)
      const model = existing ?? monaco.editor.createModel(content.text, content.languageId, uri)
      models.set(path, model)

      set((state) => {
        const files = new Map(state.files)
        files.set(path, {
          path,
          name: path.split('/').pop() ?? path,
          languageId: content.languageId,
          dirty: false,
          mtimeMs: content.mtimeMs,
          eol: content.eol,
          version: 1,
          readOnly: false,
          kind: 'file',
          sourcePath: path
        })
        return { files }
      })

      // Tell the language server the document is open. Failures here mean no
      // intelligence for this file, which is not worth interrupting the open.
      void window.ide.lsp
        .didOpen(path, content.languageId, 1, content.text)
        .catch(() => undefined)

      model.onDidChangeContent(() => {
        const version = get().bumpVersion(path)
        get().markDirty(path, true)
        void window.ide.lsp.didChange(path, version, model.getValue()).catch(() => undefined)
      })
    }

    set((state) => ({
      groups: { ...state.groups, [targetGroup]: [...state.groups[targetGroup], path] },
      active: { ...state.active, [targetGroup]: path },
      activeGroup: targetGroup
    }))
  },

  /**
   * Open a diff of `path` against HEAD in its own tab.
   *
   * Synchronous: the tab appears immediately and DiffView loads the two sides
   * itself, so clicking a change in source control never feels like it hung.
   */
  openDiff(path, group) {
    const targetGroup = group ?? get().activeGroup
    const tabId = diffTabId(path)

    if (get().groups[targetGroup].includes(tabId)) {
      get().setActive(tabId, targetGroup)
      return
    }

    const name = path.split('/').pop() ?? path
    set((state) => {
      const files = new Map(state.files)
      if (!files.has(tabId)) {
        files.set(tabId, {
          path: tabId,
          name: `${name} (diff)`,
          languageId: languageIdFor(path),
          dirty: false,
          mtimeMs: 0,
          eol: '\n',
          version: 1,
          readOnly: true,
          kind: 'diff',
          sourcePath: path
        })
      }
      return {
        files,
        groups: { ...state.groups, [targetGroup]: [...state.groups[targetGroup], tabId] },
        active: { ...state.active, [targetGroup]: tabId },
        activeGroup: targetGroup
      }
    })
  },

  async closeFile(path, group) {
    const file = get().files.get(path)
    if (file?.dirty) {
      const discard = await confirmDialog({
        title: `Save changes to ${file.name}?`,
        message: 'Your changes will be lost if you close without saving.',
        confirmLabel: "Don't Save",
        danger: true
      })
      if (!discard) return
    }

    set((state) => {
      const remaining = state.groups[group].filter((p) => p !== path)
      const wasActive = state.active[group] === path
      // Focus the tab that took this one's place, or the new last tab.
      const index = state.groups[group].indexOf(path)
      const nextActive = wasActive
        ? (remaining[Math.min(index, remaining.length - 1)] ?? null)
        : state.active[group]

      return {
        groups: { ...state.groups, [group]: remaining },
        active: { ...state.active, [group]: nextActive }
      }
    })

    // A diff tab owns no shared model and was never opened with the language
    // server, so it needs none of the teardown below.
    if (isDiffTab(path)) {
      set((state) => {
        const files = new Map(state.files)
        files.delete(path)
        return { files }
      })
      if (get().groups.secondary.length === 0 && get().splitVisible) {
        set({ splitVisible: false, activeGroup: 'primary' })
      }
      return
    }

    // Dispose the model only when no group still shows the file.
    const { groups } = get()
    const stillOpen = groups.primary.includes(path) || groups.secondary.includes(path)
    if (!stillOpen) {
      models.get(path)?.dispose()
      models.delete(path)
      set((state) => {
        const files = new Map(state.files)
        files.delete(path)
        const viewState = new Map(state.viewState)
        viewState.delete(path)
        return { files, viewState }
      })
      void window.ide.lsp.didClose(path).catch(() => undefined)
    }

    if (get().groups.secondary.length === 0 && get().splitVisible) {
      set({ splitVisible: false, activeGroup: 'primary' })
    }
  },

  async closeAll(group) {
    const targets = group
      ? [...get().groups[group]]
      : [...new Set([...get().groups.primary, ...get().groups.secondary])]
    for (const path of targets) {
      await get().closeFile(path, group ?? 'primary')
      if (!group) await get().closeFile(path, 'secondary')
    }
  },

  setActive(path, group) {
    set((state) => ({
      active: { ...state.active, [group]: path },
      activeGroup: group
    }))
  },

  setActiveGroup(group) {
    set({ activeGroup: group })
  },

  toggleSplit() {
    const { splitVisible, groups, active } = get()
    if (splitVisible) {
      set({ splitVisible: false, activeGroup: 'primary' })
      return
    }
    // Opening the split with nothing in it is confusing; seed it with the
    // file the user is looking at.
    const seed = active.primary
    set({
      splitVisible: true,
      activeGroup: 'secondary',
      ...(seed && groups.secondary.length === 0
        ? {
            groups: { ...groups, secondary: [seed] },
            active: { ...active, secondary: seed }
          }
        : {})
    })
  },

  markDirty(path, dirty) {
    set((state) => {
      const file = state.files.get(path)
      if (!file || file.dirty === dirty) return state
      const files = new Map(state.files)
      files.set(path, { ...file, dirty })
      return { files }
    })
  },

  bumpVersion(path) {
    const file = get().files.get(path)
    if (!file) return 1
    const version = file.version + 1
    set((state) => {
      const files = new Map(state.files)
      const current = files.get(path)
      if (current) files.set(path, { ...current, version })
      return { files }
    })
    return version
  },

  async save(path) {
    const target = path ?? get().active[get().activeGroup]
    if (!target) return
    const file = get().files.get(target)
    const model = models.get(target)
    if (!file || !model) return

    // Monaco normalises to \n internally; restore the file's original ending.
    const text = model.getValue()
    const onDisk = file.eol === '\r\n' ? text.replaceAll('\n', '\r\n') : text

    const result = await window.ide.fs.write(target, onDisk, file.mtimeMs)
    set((state) => {
      const files = new Map(state.files)
      const current = files.get(target)
      if (current) files.set(target, { ...current, dirty: false, mtimeMs: result.mtimeMs })
      return { files }
    })

    void window.ide.lsp.didSave(target, text).catch(() => undefined)
  },

  async saveAll() {
    const dirty = [...get().files.values()].filter((f) => f.dirty)
    for (const file of dirty) {
      await get().save(file.path)
    }
  },

  async saveAs(path) {
    const model = models.get(path)
    if (!model) return
    const file = get().files.get(path)
    const suggested = file?.name ?? 'untitled.txt'

    const destination = await window.ide.fs.saveAsPath(suggested)
    if (!destination) return

    await window.ide.fs.write(destination, model.getValue())
    await get().openFile(destination, get().activeGroup)
  },

  async reloadFromDisk(path) {
    const model = models.get(path)
    if (!model) return
    const content = await window.ide.fs.read(path)
    // pushEditOperations rather than setValue, so the undo stack survives.
    model.pushEditOperations(
      [],
      [{ range: model.getFullModelRange(), text: content.text }],
      () => null
    )
    set((state) => {
      const files = new Map(state.files)
      const current = files.get(path)
      if (current) files.set(path, { ...current, dirty: false, mtimeMs: content.mtimeMs })
      return { files }
    })
  },

  saveViewState(path, state) {
    if (!state) return
    set((prev) => {
      const viewState = new Map(prev.viewState)
      viewState.set(path, state)
      return { viewState }
    })
  }
}))

/** Language id for a path, re-exported so components need not import shared. */
export { languageIdFor }
