/**
 * User settings, mirrored from the main process.
 */

import { create } from 'zustand'
import type { Settings } from '@shared/types.js'

const FALLBACK: Settings = {
  'editor.fontFamily': "'JetBrains Mono', 'Fira Code', 'DejaVu Sans Mono', monospace",
  'editor.fontSize': 13,
  'editor.tabSize': 2,
  'editor.insertSpaces': true,
  'editor.wordWrap': 'off',
  'editor.minimap': true,
  'editor.renderWhitespace': 'boundary',
  'editor.formatOnSave': false,
  'workbench.theme': 'ide-dark',
  'terminal.fontSize': 13,
  'terminal.shell': null,
  'files.excludeGlobs': [],
  'lsp.serverPaths': {}
}

interface SettingsState {
  values: Settings
  loaded: boolean
  load(): Promise<void>
  update(partial: Partial<Settings>): Promise<void>
  toggleTheme(): Promise<void>
}

export const useSettings = create<SettingsState>((set, get) => ({
  values: FALLBACK,
  loaded: false,

  async load() {
    const values = await window.ide.settings.get()
    set({ values, loaded: true })
    applyTheme(values['workbench.theme'])
  },

  async update(partial) {
    const values = await window.ide.settings.set(partial)
    set({ values })
    if ('workbench.theme' in partial) applyTheme(values['workbench.theme'])
  },

  async toggleTheme() {
    const next = get().values['workbench.theme'] === 'ide-dark' ? 'ide-light' : 'ide-dark'
    await get().update({ 'workbench.theme': next })
  }
}))

/** Drives both the CSS custom properties and the Monaco theme. */
export function applyTheme(theme: Settings['workbench.theme']): void {
  document.documentElement.dataset.theme = theme
  void import('monaco-editor').then((monaco) => monaco.editor.setTheme(theme))
}
