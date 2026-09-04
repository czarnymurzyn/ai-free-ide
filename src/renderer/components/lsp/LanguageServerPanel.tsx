/**
 * Language server status.
 *
 * The important thing this panel communicates: servers come from the user's
 * own machine. There is no install button, because installing would mean
 * downloading. It shows what was found on PATH and what each one is doing.
 */

import { useEffect } from 'react'
import { RefreshIcon } from '../Icons.js'
import { useLsp } from '../../state/lsp.js'
import './LanguageServerPanel.css'

export function LanguageServerPanel(): React.ReactElement {
  const servers = useLsp((s) => s.servers)
  const setServers = useLsp((s) => s.setServers)

  useEffect(() => {
    void window.ide.lsp.status().then(setServers)
  }, [setServers])

  return (
    <div className="lsp-panel">
      <div className="lsp-panel__header">
        <span>Detected on PATH</span>
        <button
          type="button"
          className="lsp-panel__refresh"
          onClick={() => void window.ide.lsp.status().then(setServers)}
          title="Re-scan PATH"
          aria-label="Re-scan PATH for language servers"
        >
          <RefreshIcon size={13} />
        </button>
      </div>

      {servers.length === 0 ? (
        <div className="lsp-panel__empty">
          <p>No language servers found on your PATH.</p>
          <p>
            Syntax highlighting works for every supported language regardless. For
            go-to-definition, hover and diagnostics, install a language server with your own
            package manager — this IDE will pick it up automatically.
          </p>
          <p className="lsp-panel__hint">
            You can also set an explicit path per server under <code>lsp.serverPaths</code> in
            settings.
          </p>
        </div>
      ) : (
        <ul className="lsp-panel__list">
          {servers.map((server) => (
            <li key={server.id} className="lsp-server">
              <div className="lsp-server__row">
                <span className={`lsp-server__dot lsp-server__dot--${server.state}`} />
                <span className="lsp-server__label truncate">{server.label}</span>
                <span className="lsp-server__state">{server.state}</span>
              </div>
              <div className="lsp-server__meta truncate" title={server.binary ?? ''}>
                {server.binary}
              </div>
              <div className="lsp-server__languages">{server.languages.join(', ')}</div>
              {server.detail && <div className="lsp-server__detail">{server.detail}</div>}
              {server.state === 'failed' && (
                <button
                  type="button"
                  className="lsp-server__restart"
                  onClick={() => void window.ide.lsp.restart(server.id)}
                >
                  Restart
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
