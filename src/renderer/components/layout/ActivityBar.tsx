import { FilesIcon, GitIcon, SearchIcon, ServerIcon } from '../Icons.js'
import { useGit } from '../../state/git.js'
import { useLsp } from '../../state/lsp.js'
import { useUi, type SidebarView } from '../../state/ui.js'
import './ActivityBar.css'

interface Entry {
  id: SidebarView
  label: string
  shortcut: string
  Icon: (props: { size?: number }) => React.ReactElement
}

const ENTRIES: Entry[] = [
  { id: 'explorer', label: 'Explorer', shortcut: 'Ctrl+Shift+E', Icon: FilesIcon },
  { id: 'search', label: 'Search', shortcut: 'Ctrl+Shift+F', Icon: SearchIcon },
  { id: 'git', label: 'Source Control', shortcut: 'Ctrl+Shift+G', Icon: GitIcon },
  { id: 'lsp', label: 'Language Servers', shortcut: '', Icon: ServerIcon }
]

export function ActivityBar(): React.ReactElement {
  const { sidebarView, sidebarVisible, setSidebarView } = useUi()
  const changeCount = useGit((s) => s.status.changes.length)
  const serverCount = useLsp((s) => s.servers.filter((x) => x.state === 'running').length)

  return (
    <nav className="activity-bar app__activity" aria-label="Views">
      {ENTRIES.map(({ id, label, shortcut, Icon }) => {
        const active = sidebarVisible && sidebarView === id
        const badge = id === 'git' ? changeCount : id === 'lsp' ? serverCount : 0

        return (
          <button
            key={id}
            type="button"
            className={`activity-bar__item${active ? ' activity-bar__item--active' : ''}`}
            onClick={() => setSidebarView(id)}
            title={shortcut ? `${label} (${shortcut})` : label}
            aria-label={label}
            aria-pressed={active}
          >
            <Icon size={20} />
            {badge > 0 && (
              <span className="activity-bar__badge">{badge > 99 ? '99+' : badge}</span>
            )}
          </button>
        )
      })}
    </nav>
  )
}
