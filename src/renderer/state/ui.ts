/**
 * Layout and transient UI state: which sidebar view is showing, whether the
 * bottom panel is open, and which overlay (palette, quick-open) has focus.
 */

import { create } from 'zustand'

export type SidebarView = 'explorer' | 'search' | 'git' | 'lsp'
export type PanelTab = 'terminal' | 'problems' | 'output'
export type Overlay = 'none' | 'palette' | 'quickopen' | 'symbols' | 'branches' | 'about'

interface UiState {
  sidebarView: SidebarView
  sidebarVisible: boolean
  sidebarWidth: number
  panelVisible: boolean
  panelTab: PanelTab
  panelHeight: number
  overlay: Overlay
  /** Transient message shown in the status bar. */
  notice: { text: string; kind: 'info' | 'error' } | null

  setSidebarView(view: SidebarView): void
  showSidebarView(view: SidebarView): void
  toggleSidebar(): void
  setSidebarWidth(width: number): void
  showPanel(tab?: PanelTab): void
  togglePanel(): void
  setPanelTab(tab: PanelTab): void
  setPanelHeight(height: number): void
  setOverlay(overlay: Overlay): void
  notify(text: string, kind?: 'info' | 'error'): void
}

let noticeTimer: ReturnType<typeof setTimeout> | null = null

export const useUi = create<UiState>((set, get) => ({
  sidebarView: 'explorer',
  sidebarVisible: true,
  sidebarWidth: 260,
  panelVisible: false,
  panelTab: 'terminal',
  panelHeight: 260,
  overlay: 'none',
  notice: null,

  setSidebarView(view) {
    // Clicking the active icon collapses the sidebar, as in most IDEs.
    const { sidebarView, sidebarVisible } = get()
    if (sidebarView === view && sidebarVisible) {
      set({ sidebarVisible: false })
      return
    }
    set({ sidebarView: view, sidebarVisible: true })
  },

  /**
   * Show a view without the collapse-on-repeat behaviour above.
   *
   * "Find in Files" must always end with the search box on screen and focused:
   * hiding the panel when the user asks to search again is never what they
   * meant, even though clicking the same activity-bar icon twice should
   * collapse it.
   */
  showSidebarView(view) {
    set({ sidebarView: view, sidebarVisible: true })
  },

  toggleSidebar() {
    set((state) => ({ sidebarVisible: !state.sidebarVisible }))
  },

  setSidebarWidth(width) {
    set({ sidebarWidth: Math.max(180, Math.min(width, 640)) })
  },

  showPanel(tab) {
    set({ panelVisible: true, ...(tab ? { panelTab: tab } : {}) })
  },

  togglePanel() {
    set((state) => ({ panelVisible: !state.panelVisible }))
  },

  setPanelTab(tab) {
    set({ panelTab: tab, panelVisible: true })
  },

  setPanelHeight(height) {
    set({ panelHeight: Math.max(120, Math.min(height, window.innerHeight - 200)) })
  },

  setOverlay(overlay) {
    set({ overlay })
  },

  notify(text, kind = 'info') {
    if (noticeTimer) clearTimeout(noticeTimer)
    set({ notice: { text, kind } })
    noticeTimer = setTimeout(() => set({ notice: null }), kind === 'error' ? 8000 : 4000)
  }
}))
