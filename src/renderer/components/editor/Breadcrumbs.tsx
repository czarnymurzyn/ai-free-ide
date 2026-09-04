/**
 * The path of the active file, above the editor.
 *
 * With several same-named files open (three `index.ts` tabs is normal), the
 * tab label alone does not tell you which one you are looking at. Each segment
 * is clickable and reveals that folder in the explorer.
 */

import { FileIcon } from '../FileIcon.js'
import { ChevronRight } from '../Icons.js'
import { useEditors, type GroupId } from '../../state/editors.js'
import { useUi } from '../../state/ui.js'
import { useWorkspace } from '../../state/workspace.js'
import './Breadcrumbs.css'

export function Breadcrumbs({ group }: { group: GroupId }): React.ReactElement | null {
  const tabId = useEditors((s) => s.active[group])
  const file = useEditors((s) => (tabId ? s.files.get(tabId) : undefined))
  const root = useWorkspace((s) => s.root)
  const { expandTo, loadChildren, toggle } = useWorkspace()
  const setSidebarView = useUi((s) => s.setSidebarView)

  if (!file || !root) return null

  const path = file.sourcePath
  if (!path.startsWith(root)) return null

  const relative = path.slice(root.length + 1)
  const segments = relative.split('/').filter(Boolean)
  if (segments.length === 0) return null

  const fileName = segments[segments.length - 1]!
  const folders = segments.slice(0, -1)

  const revealFolder = async (index: number): Promise<void> => {
    // Everything up to and including the clicked segment.
    const dir = [root, ...folders.slice(0, index + 1)].join('/')
    setSidebarView('explorer')
    await expandTo(`${dir}/x`) // expandTo walks ancestors of a file path
    await loadChildren(dir)
    if (!useWorkspace.getState().expanded.has(dir)) await toggle(dir)
  }

  return (
    <nav className="breadcrumbs" aria-label="File path">
      <button
        type="button"
        className="breadcrumbs__segment breadcrumbs__segment--root"
        onClick={() => setSidebarView('explorer')}
        title={root}
      >
        {root.split('/').pop()}
      </button>

      {folders.map((folder, index) => (
        <span className="breadcrumbs__group" key={`${folder}-${index}`}>
          <ChevronRight size={11} />
          <button
            type="button"
            className="breadcrumbs__segment"
            onClick={() => void revealFolder(index)}
          >
            {folder}
          </button>
        </span>
      ))}

      <span className="breadcrumbs__group">
        <ChevronRight size={11} />
        <span className="breadcrumbs__segment breadcrumbs__segment--file">
          <FileIcon name={fileName} size={12} />
          {fileName}
          {file.kind === 'diff' && <span className="breadcrumbs__badge">diff</span>}
        </span>
      </span>
    </nav>
  )
}
