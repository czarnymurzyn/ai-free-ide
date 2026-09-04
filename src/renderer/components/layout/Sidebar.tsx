/**
 * The left sidebar: one view at a time, with a drag handle to resize.
 */

import { useCallback, useEffect, useRef } from 'react'
import { FileTree } from '../explorer/FileTree.js'
import { SourceControlPanel } from '../git/SourceControlPanel.js'
import { LanguageServerPanel } from '../lsp/LanguageServerPanel.js'
import { SearchPanel } from '../search/SearchPanel.js'
import { useUi } from '../../state/ui.js'
import { useWorkspace } from '../../state/workspace.js'
import './Sidebar.css'

const TITLES = {
  explorer: 'Explorer',
  search: 'Search',
  git: 'Source Control',
  lsp: 'Language Servers'
} as const

export function Sidebar(): React.ReactElement | null {
  const { sidebarView, sidebarVisible, sidebarWidth, setSidebarWidth } = useUi()
  const root = useWorkspace((s) => s.root)
  const dragging = useRef(false)

  const onPointerDown = useCallback((event: React.PointerEvent) => {
    dragging.current = true
    event.currentTarget.setPointerCapture(event.pointerId)
  }, [])

  useEffect(() => {
    const onMove = (event: PointerEvent): void => {
      if (!dragging.current) return
      // The sidebar starts after the activity bar, so subtract its width.
      setSidebarWidth(event.clientX - 48)
    }
    const onUp = (): void => {
      dragging.current = false
    }

    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
  }, [setSidebarWidth])

  if (!sidebarVisible) return null

  return (
    <aside className="sidebar" style={{ width: sidebarWidth }} aria-label={TITLES[sidebarView]}>
      <header className="sidebar__header">
        <span className="sidebar__title">{TITLES[sidebarView]}</span>
        {sidebarView === 'explorer' && root && (
          <span className="sidebar__subtitle truncate" title={root}>
            {root.split('/').pop()}
          </span>
        )}
      </header>

      <div className="sidebar__body">
        {sidebarView === 'explorer' && <FileTree />}
        {sidebarView === 'search' && <SearchPanel />}
        {sidebarView === 'git' && <SourceControlPanel />}
        {sidebarView === 'lsp' && <LanguageServerPanel />}
      </div>

      <div
        className="sidebar__resizer"
        onPointerDown={onPointerDown}
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize sidebar"
      />
    </aside>
  )
}
