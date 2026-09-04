/**
 * One connection to one language server.
 *
 * Servers are spawned lazily -- the first time a file of a matching language
 * is opened -- because starting every installed server on workspace open would
 * cost seconds and hundreds of megabytes for languages the user never touches.
 */

import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { pathToFileURL, fileURLToPath } from 'node:url'
import {
  createMessageConnection,
  StreamMessageReader,
  StreamMessageWriter,
  type MessageConnection
} from 'vscode-jsonrpc/node'
import type { LanguageServerSpec, LanguageServerState } from '../../shared/types.js'

export interface ServerEvents {
  onDiagnostics(path: string, diagnostics: unknown[]): void
  onStateChange(id: string, state: LanguageServerState, detail?: string): void
}

/** How long to wait for `initialize` before declaring the server dead. */
const INIT_TIMEOUT_MS = 20_000

export class LanguageServer {
  readonly id: string
  readonly spec: LanguageServerSpec
  readonly binary: string

  private proc: ChildProcessWithoutNullStreams | null = null
  private connection: MessageConnection | null = null
  private initialized: Promise<void> | null = null
  private openDocuments = new Set<string>()
  private disposed = false

  /** Server capabilities from the initialize response, for feature gating. */
  capabilities: Record<string, unknown> = {}

  constructor(
    spec: LanguageServerSpec,
    binary: string,
    private readonly rootPath: string,
    private readonly events: ServerEvents
  ) {
    this.id = spec.id
    this.spec = spec
    this.binary = binary
  }

  /** Idempotent: concurrent callers share one startup. */
  start(): Promise<void> {
    if (this.initialized) return this.initialized
    this.initialized = this.doStart()
    return this.initialized
  }

  private async doStart(): Promise<void> {
    this.events.onStateChange(this.id, 'starting')

    const proc = spawn(this.binary, this.spec.args, {
      cwd: this.rootPath,
      env: process.env,
      stdio: ['pipe', 'pipe', 'pipe']
    })
    this.proc = proc

    proc.on('error', (err) => {
      this.events.onStateChange(this.id, 'failed', err.message)
      this.cleanup()
    })

    proc.on('exit', (code) => {
      if (this.disposed) return
      this.events.onStateChange(
        this.id,
        'failed',
        code === 0 ? 'server exited' : `server exited with code ${code}`
      )
      this.cleanup()
    })

    // Servers use stderr for logging; surfacing it would be noise, but a
    // crash message is worth keeping for the status detail.
    let lastStderr = ''
    proc.stderr.setEncoding('utf8')
    proc.stderr.on('data', (chunk: string) => {
      lastStderr = chunk.slice(-500)
    })

    const connection = createMessageConnection(
      new StreamMessageReader(proc.stdout),
      new StreamMessageWriter(proc.stdin)
    )
    this.connection = connection

    connection.onNotification('textDocument/publishDiagnostics', (params: unknown) => {
      const typed = params as { uri?: string; diagnostics?: unknown[] }
      if (!typed?.uri) return
      try {
        this.events.onDiagnostics(fileURLToPath(typed.uri), typed.diagnostics ?? [])
      } catch {
        /* a non-file uri; nothing to show in the editor */
      }
    })

    // Servers may ask the client for configuration or to register capabilities.
    // Answering minimally keeps them happy without implementing the full
    // dynamic-registration dance.
    connection.onRequest('workspace/configuration', (params: unknown) => {
      const items = (params as { items?: unknown[] })?.items ?? []
      return items.map(() => ({}))
    })
    connection.onRequest('client/registerCapability', () => null)
    connection.onRequest('client/unregisterCapability', () => null)
    connection.onRequest('window/workDoneProgress/create', () => null)
    connection.onNotification('window/logMessage', () => {})
    connection.onNotification('$/progress', () => {})

    connection.listen()

    const initResult = await withTimeout(
      connection.sendRequest('initialize', {
        processId: process.pid,
        clientInfo: { name: 'ai-free-ide', version: '0.1.0' },
        rootUri: pathToFileURL(this.rootPath).toString(),
        workspaceFolders: [
          { uri: pathToFileURL(this.rootPath).toString(), name: this.rootPath.split('/').pop() }
        ],
        capabilities: CLIENT_CAPABILITIES,
        initializationOptions: {}
      }),
      INIT_TIMEOUT_MS,
      `${this.spec.label} did not respond to initialize. ${lastStderr}`.trim()
    )

    this.capabilities = ((initResult as { capabilities?: Record<string, unknown> })?.capabilities ??
      {}) as Record<string, unknown>

    connection.sendNotification('initialized', {})
    this.events.onStateChange(this.id, 'running')
  }

  async didOpen(path: string, languageId: string, version: number, text: string): Promise<void> {
    await this.start()
    this.openDocuments.add(path)
    this.connection?.sendNotification('textDocument/didOpen', {
      textDocument: { uri: pathToFileURL(path).toString(), languageId, version, text }
    })
  }

  async didChange(path: string, version: number, text: string): Promise<void> {
    if (!this.openDocuments.has(path)) return
    // Full-document sync. Incremental sync is a meaningful optimisation only
    // for very large files, and full sync removes a whole class of
    // desynchronisation bugs between the editor model and the server.
    this.connection?.sendNotification('textDocument/didChange', {
      textDocument: { uri: pathToFileURL(path).toString(), version },
      contentChanges: [{ text }]
    })
  }

  async didSave(path: string, text: string): Promise<void> {
    if (!this.openDocuments.has(path)) return
    this.connection?.sendNotification('textDocument/didSave', {
      textDocument: { uri: pathToFileURL(path).toString() },
      text
    })
  }

  async didClose(path: string): Promise<void> {
    if (!this.openDocuments.delete(path)) return
    this.connection?.sendNotification('textDocument/didClose', {
      textDocument: { uri: pathToFileURL(path).toString() }
    })
  }

  async request<T>(method: string, params: unknown): Promise<T> {
    await this.start()
    if (!this.connection) throw new Error(`${this.spec.label} is not running`)
    return this.connection.sendRequest<T>(method, params)
  }

  hasOpenDocument(path: string): boolean {
    return this.openDocuments.has(path)
  }

  async dispose(): Promise<void> {
    this.disposed = true
    try {
      await withTimeout(this.connection?.sendRequest('shutdown') ?? Promise.resolve(), 2000, '')
      this.connection?.sendNotification('exit')
    } catch {
      /* the server is already gone or unresponsive */
    }
    this.cleanup()
  }

  private cleanup(): void {
    try {
      this.connection?.dispose()
    } catch {
      /* ignore */
    }
    this.connection = null
    if (this.proc && !this.proc.killed) this.proc.kill()
    this.proc = null
    this.initialized = null
    this.openDocuments.clear()
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message || 'timed out')), ms)
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (err: unknown) => {
        clearTimeout(timer)
        reject(err as Error)
      }
    )
  })
}

/**
 * What this client supports. Advertising a capability the UI does not
 * implement makes servers send responses that get dropped, so this list is
 * kept in step with the providers registered in the renderer's lsp-bridge.
 */
const CLIENT_CAPABILITIES = {
  textDocument: {
    synchronization: { dynamicRegistration: false, didSave: true, willSave: false },
    publishDiagnostics: { relatedInformation: true, versionSupport: false },
    completion: {
      dynamicRegistration: false,
      completionItem: {
        snippetSupport: true,
        documentationFormat: ['markdown', 'plaintext'],
        insertReplaceSupport: false,
        resolveSupport: { properties: ['documentation', 'detail', 'additionalTextEdits'] }
      },
      contextSupport: true
    },
    hover: { dynamicRegistration: false, contentFormat: ['markdown', 'plaintext'] },
    signatureHelp: {
      dynamicRegistration: false,
      signatureInformation: { documentationFormat: ['markdown', 'plaintext'] }
    },
    definition: { dynamicRegistration: false, linkSupport: false },
    typeDefinition: { dynamicRegistration: false, linkSupport: false },
    implementation: { dynamicRegistration: false, linkSupport: false },
    references: { dynamicRegistration: false },
    documentHighlight: { dynamicRegistration: false },
    documentSymbol: { dynamicRegistration: false, hierarchicalDocumentSymbolSupport: true },
    formatting: { dynamicRegistration: false },
    rangeFormatting: { dynamicRegistration: false },
    rename: { dynamicRegistration: false, prepareSupport: false },
    codeAction: {
      dynamicRegistration: false,
      codeActionLiteralSupport: {
        codeActionKind: {
          valueSet: ['quickfix', 'refactor', 'refactor.extract', 'refactor.inline', 'source', 'source.organizeImports']
        }
      }
    }
  },
  workspace: {
    workspaceFolders: true,
    configuration: true,
    symbol: { dynamicRegistration: false },
    didChangeConfiguration: { dynamicRegistration: false }
  },
  general: {
    // Servers assume UTF-16 offsets when the client says nothing; Monaco uses
    // UTF-16 too, so saying so explicitly keeps both sides in agreement.
    positionEncodings: ['utf-16']
  }
}
