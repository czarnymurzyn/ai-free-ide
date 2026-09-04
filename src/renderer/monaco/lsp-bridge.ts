/**
 * Adapter between the Language Server Protocol and Monaco's provider APIs.
 *
 * The coordinate conversion this leans on lives in shared/lsp-position.ts,
 * kept pure and free of any monaco import so it can be tested directly -- see
 * the note there on why an off-by-one in that code is so easy to miss.
 */

import * as monaco from 'monaco-editor'
import {
  toLspPosition,
  toLspRange,
  toMarkerSeverity,
  toMonacoPosition,
  toMonacoRange,
  type LspRange
} from '@shared/lsp-position.js'
import { useLsp } from '../state/lsp.js'

export { toLspPosition, toLspRange, toMarkerSeverity, toMonacoPosition, toMonacoRange }

// ------------------------------------------------------------- enum maps

/** LSP CompletionItemKind (1-25) -> Monaco CompletionItemKind. */
const COMPLETION_KIND: Record<number, monaco.languages.CompletionItemKind> = {
  1: monaco.languages.CompletionItemKind.Text,
  2: monaco.languages.CompletionItemKind.Method,
  3: monaco.languages.CompletionItemKind.Function,
  4: monaco.languages.CompletionItemKind.Constructor,
  5: monaco.languages.CompletionItemKind.Field,
  6: monaco.languages.CompletionItemKind.Variable,
  7: monaco.languages.CompletionItemKind.Class,
  8: monaco.languages.CompletionItemKind.Interface,
  9: monaco.languages.CompletionItemKind.Module,
  10: monaco.languages.CompletionItemKind.Property,
  11: monaco.languages.CompletionItemKind.Unit,
  12: monaco.languages.CompletionItemKind.Value,
  13: monaco.languages.CompletionItemKind.Enum,
  14: monaco.languages.CompletionItemKind.Keyword,
  15: monaco.languages.CompletionItemKind.Snippet,
  16: monaco.languages.CompletionItemKind.Color,
  17: monaco.languages.CompletionItemKind.File,
  18: monaco.languages.CompletionItemKind.Reference,
  19: monaco.languages.CompletionItemKind.Folder,
  20: monaco.languages.CompletionItemKind.EnumMember,
  21: monaco.languages.CompletionItemKind.Constant,
  22: monaco.languages.CompletionItemKind.Struct,
  23: monaco.languages.CompletionItemKind.Event,
  24: monaco.languages.CompletionItemKind.Operator,
  25: monaco.languages.CompletionItemKind.TypeParameter
}

/** LSP SymbolKind (1-26) -> Monaco SymbolKind. */
const SYMBOL_KIND: Record<number, monaco.languages.SymbolKind> = {
  1: monaco.languages.SymbolKind.File,
  2: monaco.languages.SymbolKind.Module,
  3: monaco.languages.SymbolKind.Namespace,
  4: monaco.languages.SymbolKind.Package,
  5: monaco.languages.SymbolKind.Class,
  6: monaco.languages.SymbolKind.Method,
  7: monaco.languages.SymbolKind.Property,
  8: monaco.languages.SymbolKind.Field,
  9: monaco.languages.SymbolKind.Constructor,
  10: monaco.languages.SymbolKind.Enum,
  11: monaco.languages.SymbolKind.Interface,
  12: monaco.languages.SymbolKind.Function,
  13: monaco.languages.SymbolKind.Variable,
  14: monaco.languages.SymbolKind.Constant,
  15: monaco.languages.SymbolKind.String,
  16: monaco.languages.SymbolKind.Number,
  17: monaco.languages.SymbolKind.Boolean,
  18: monaco.languages.SymbolKind.Array,
  19: monaco.languages.SymbolKind.Object,
  20: monaco.languages.SymbolKind.Key,
  21: monaco.languages.SymbolKind.Null,
  22: monaco.languages.SymbolKind.EnumMember,
  23: monaco.languages.SymbolKind.Struct,
  24: monaco.languages.SymbolKind.Event,
  25: monaco.languages.SymbolKind.Operator,
  26: monaco.languages.SymbolKind.TypeParameter
}

// ----------------------------------------------------------- diagnostics

interface LspDiagnostic {
  range: LspRange
  severity?: number
  code?: string | number
  source?: string
  message: string
}

/**
 * Apply a server's diagnostics to the model for `path`.
 *
 * Markers are owned by 'lsp' so they replace each other wholesale on every
 * publish and never mix with Monaco's own syntax markers.
 */
export function applyDiagnostics(path: string, diagnostics: unknown[]): void {
  const model = monaco.editor.getModel(monaco.Uri.file(path))
  if (!model) return

  const markers = (diagnostics as LspDiagnostic[]).map((d): monaco.editor.IMarkerData => ({
    ...toMonacoRange(d.range),
    message: d.message,
    severity: toMarkerSeverity(d.severity),
    source: d.source ?? 'lsp',
    ...(d.code !== undefined ? { code: String(d.code) } : {})
  }))

  // Owner 'lsp' so these replace each other wholesale on every publish and
  // never mix with the markers Monaco's own workers own. The store is updated
  // by the marker listener below, not here, so both sources reach the
  // Problems panel by the same path.
  monaco.editor.setModelMarkers(model, 'lsp', markers)
}

/**
 * Mirror *all* editor markers into the Problems panel.
 *
 * Diagnostics arrive from two independent places: language servers over IPC,
 * and Monaco's own bundled workers (JSON, CSS, HTML syntax validation). Both
 * end up as model markers, so subscribing here is the one place that sees
 * everything -- reading only the LSP side would silently omit JSON and CSS
 * errors from the panel even though they are underlined in the editor.
 */
export function watchMarkers(): monaco.IDisposable {
  return monaco.editor.onDidChangeMarkers((uris) => {
    for (const uri of uris) {
      const markers = monaco.editor.getModelMarkers({ resource: uri })
      useLsp.getState().setDiagnostics(uri.fsPath, markers)
    }
  })
}

// ------------------------------------------------------------- providers

/** Ask the main process for an LSP response for the file behind a model. */
async function request<T>(model: monaco.editor.ITextModel, method: string, params: object): Promise<T | null> {
  const path = model.uri.fsPath
  try {
    return await window.ide.lsp.request<T>(path, method, {
      textDocument: { uri: model.uri.toString() },
      ...params
    })
  } catch {
    // A server that is starting, crashed, or does not implement the method:
    // the editor falls back to its built-in behaviour.
    return null
  }
}

let registered = false

/**
 * Register every provider once, for every language.
 *
 * Registering per-language as servers appear would mean re-registering
 * whenever a server starts; registering once for '*' and returning null when
 * no server owns the file is simpler and has the same effect.
 */
export function registerLspProviders(): void {
  if (registered) return
  registered = true

  // '*' matches every language; the providers return null when no server
  // owns the file, so registering broadly costs nothing.
  const selector: monaco.languages.LanguageSelector = '*'

  // ---- completion -----------------------------------------------------
  monaco.languages.registerCompletionItemProvider(selector, {
    triggerCharacters: ['.', ':', '>', '"', "'", '/', '@', '<', '(', ' '],
    async provideCompletionItems(model, position, context) {
      const result = await request<CompletionResponse>(model, 'textDocument/completion', {
        position: toLspPosition(position),
        context: {
          triggerKind: context.triggerKind === 1 ? 1 : 2,
          ...(context.triggerCharacter ? { triggerCharacter: context.triggerCharacter } : {})
        }
      })
      if (!result) return { suggestions: [] }

      const items = Array.isArray(result) ? result : (result.items ?? [])
      const word = model.getWordUntilPosition(position)
      const defaultRange: monaco.IRange = {
        startLineNumber: position.lineNumber,
        endLineNumber: position.lineNumber,
        startColumn: word.startColumn,
        endColumn: word.endColumn
      }

      return {
        incomplete: Array.isArray(result) ? false : (result.isIncomplete ?? false),
        suggestions: items.map((item): monaco.languages.CompletionItem => {
          const edit = item.textEdit
          const range = edit && 'range' in edit ? toMonacoRange(edit.range) : defaultRange
          const insertText = edit?.newText ?? item.insertText ?? item.label

          return {
            label: item.label,
            kind: COMPLETION_KIND[item.kind ?? 1] ?? monaco.languages.CompletionItemKind.Text,
            insertText,
            range,
            detail: item.detail,
            documentation: toMarkdown(item.documentation),
            sortText: item.sortText,
            filterText: item.filterText,
            preselect: item.preselect,
            // insertTextFormat 2 means the server sent a snippet with
            // ${1:placeholder} markers Monaco knows how to expand.
            insertTextRules:
              item.insertTextFormat === 2
                ? monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet
                : undefined,
            additionalTextEdits: item.additionalTextEdits?.map((e) => ({
              range: toMonacoRange(e.range),
              text: e.newText
            }))
          }
        })
      }
    }
  })

  // ---- hover ----------------------------------------------------------
  monaco.languages.registerHoverProvider(selector, {
    async provideHover(model, position) {
      const result = await request<HoverResponse>(model, 'textDocument/hover', {
        position: toLspPosition(position)
      })
      if (!result?.contents) return null

      const contents = normaliseHoverContents(result.contents)
      if (contents.length === 0) return null

      return {
        contents,
        ...(result.range ? { range: toMonacoRange(result.range) } : {})
      }
    }
  })

  // ---- definition / type definition / implementation ------------------
  monaco.languages.registerDefinitionProvider(selector, {
    async provideDefinition(model, position) {
      const result = await request<LocationResponse>(model, 'textDocument/definition', {
        position: toLspPosition(position)
      })
      return toLocationLinks(result)
    }
  })

  monaco.languages.registerTypeDefinitionProvider(selector, {
    async provideTypeDefinition(model, position) {
      const result = await request<LocationResponse>(model, 'textDocument/typeDefinition', {
        position: toLspPosition(position)
      })
      return toLocationLinks(result)
    }
  })

  monaco.languages.registerImplementationProvider(selector, {
    async provideImplementation(model, position) {
      const result = await request<LocationResponse>(model, 'textDocument/implementation', {
        position: toLspPosition(position)
      })
      return toLocationLinks(result)
    }
  })

  // ---- references -----------------------------------------------------
  monaco.languages.registerReferenceProvider(selector, {
    async provideReferences(model, position, context) {
      const result = await request<LspLocation[]>(model, 'textDocument/references', {
        position: toLspPosition(position),
        context: { includeDeclaration: context.includeDeclaration }
      })
      return toLocationLinks(result) ?? []
    }
  })

  // ---- document highlights -------------------------------------------
  monaco.languages.registerDocumentHighlightProvider(selector, {
    async provideDocumentHighlights(model, position) {
      const result = await request<Array<{ range: LspRange; kind?: number }>>(
        model,
        'textDocument/documentHighlight',
        { position: toLspPosition(position) }
      )
      if (!result) return []
      return result.map((h) => ({
        range: toMonacoRange(h.range),
        kind:
          h.kind === 3
            ? monaco.languages.DocumentHighlightKind.Write
            : monaco.languages.DocumentHighlightKind.Read
      }))
    }
  })

  // ---- document symbols (outline, go-to-symbol) -----------------------
  monaco.languages.registerDocumentSymbolProvider(selector, {
    async provideDocumentSymbols(model) {
      const result = await request<DocumentSymbol[] | SymbolInformation[]>(
        model,
        'textDocument/documentSymbol',
        {}
      )
      if (!result || result.length === 0) return []
      return result.map(toMonacoSymbol)
    }
  })

  // ---- signature help -------------------------------------------------
  monaco.languages.registerSignatureHelpProvider(selector, {
    signatureHelpTriggerCharacters: ['(', ','],
    async provideSignatureHelp(model, position) {
      const result = await request<SignatureHelpResponse>(model, 'textDocument/signatureHelp', {
        position: toLspPosition(position)
      })
      if (!result?.signatures?.length) return null

      return {
        value: {
          signatures: result.signatures.map((s) => ({
            label: s.label,
            documentation: toMarkdown(s.documentation),
            parameters: (s.parameters ?? []).map((p) => ({
              label: p.label,
              documentation: toMarkdown(p.documentation)
            }))
          })),
          activeSignature: result.activeSignature ?? 0,
          activeParameter: result.activeParameter ?? 0
        },
        dispose: () => undefined
      }
    }
  })

  // ---- rename ---------------------------------------------------------
  monaco.languages.registerRenameProvider(selector, {
    async provideRenameEdits(model, position, newName) {
      const result = await request<WorkspaceEdit>(model, 'textDocument/rename', {
        position: toLspPosition(position),
        newName
      })
      if (!result) {
        return { edits: [], rejectReason: 'This symbol cannot be renamed here.' }
      }
      return { edits: toWorkspaceEdits(result) }
    }
  })

  // ---- formatting -----------------------------------------------------
  monaco.languages.registerDocumentFormattingEditProvider(selector, {
    async provideDocumentFormattingEdits(model, options) {
      const result = await request<TextEdit[]>(model, 'textDocument/formatting', {
        options: {
          tabSize: options.tabSize,
          insertSpaces: options.insertSpaces,
          trimTrailingWhitespace: true,
          insertFinalNewline: true
        }
      })
      if (!result) return []
      return result.map((e) => ({ range: toMonacoRange(e.range), text: e.newText }))
    }
  })

  monaco.languages.registerDocumentRangeFormattingEditProvider(selector, {
    async provideDocumentRangeFormattingEdits(model, range, options) {
      const result = await request<TextEdit[]>(model, 'textDocument/rangeFormatting', {
        range: toLspRange(range),
        options: { tabSize: options.tabSize, insertSpaces: options.insertSpaces }
      })
      if (!result) return []
      return result.map((e) => ({ range: toMonacoRange(e.range), text: e.newText }))
    }
  })

  // ---- code actions ---------------------------------------------------
  monaco.languages.registerCodeActionProvider(selector, {
    async provideCodeActions(model, range, context) {
      const result = await request<CodeAction[]>(model, 'textDocument/codeAction', {
        range: toLspRange(range),
        context: {
          diagnostics: context.markers.map((m) => ({
            range: toLspRange(m),
            message: m.message,
            severity: m.severity === monaco.MarkerSeverity.Error ? 1 : 2
          })),
          only: context.only ? [context.only] : undefined
        }
      })
      if (!result) return { actions: [], dispose: () => undefined }

      const actions = result
        .filter((a) => a.edit)
        .map((a): monaco.languages.CodeAction => ({
          title: a.title,
          kind: a.kind,
          isPreferred: a.isPreferred,
          edit: { edits: toWorkspaceEdits(a.edit!) }
        }))

      return { actions, dispose: () => undefined }
    }
  })
}

// ------------------------------------------------------------- helpers

function toMarkdown(
  documentation: string | { kind?: string; value: string } | undefined
): monaco.IMarkdownString | undefined {
  if (!documentation) return undefined
  const value = typeof documentation === 'string' ? documentation : documentation.value
  if (!value) return undefined
  // Server-authored text is rendered as markdown but never as HTML, so a
  // malicious docstring cannot inject markup into the editor UI.
  return { value, isTrusted: false, supportHtml: false }
}

function normaliseHoverContents(
  contents: HoverResponse['contents']
): monaco.IMarkdownString[] {
  const list = Array.isArray(contents) ? contents : [contents]
  const out: monaco.IMarkdownString[] = []

  for (const entry of list) {
    if (typeof entry === 'string') {
      if (entry.trim()) out.push({ value: entry, isTrusted: false, supportHtml: false })
    } else if ('language' in entry && entry.language) {
      // The deprecated MarkedString form: a code block with a language tag.
      out.push({
        value: '```' + entry.language + '\n' + entry.value + '\n```',
        isTrusted: false,
        supportHtml: false
      })
    } else if ('value' in entry && entry.value.trim()) {
      out.push({ value: entry.value, isTrusted: false, supportHtml: false })
    }
  }
  return out
}

function toLocationLinks(result: LocationResponse | null): monaco.languages.Location[] | null {
  if (!result) return null
  const list = Array.isArray(result) ? result : [result]
  if (list.length === 0) return null

  return list
    .map((entry) => {
      // A server may answer with Location or LocationLink; the latter names
      // the target range differently.
      const uri = 'uri' in entry ? entry.uri : entry.targetUri
      const range = 'range' in entry ? entry.range : entry.targetSelectionRange
      if (!uri || !range) return null
      return { uri: monaco.Uri.parse(uri), range: toMonacoRange(range) }
    })
    .filter((x): x is monaco.languages.Location => x !== null)
}

function toWorkspaceEdits(edit: WorkspaceEdit): monaco.languages.IWorkspaceTextEdit[] {
  const out: monaco.languages.IWorkspaceTextEdit[] = []

  // The `changes` form: a map of uri -> edits.
  for (const [uri, edits] of Object.entries(edit.changes ?? {})) {
    for (const e of edits) {
      out.push({
        resource: monaco.Uri.parse(uri),
        textEdit: { range: toMonacoRange(e.range), text: e.newText },
        versionId: undefined
      })
    }
  }

  // The `documentChanges` form, which also carries document versions.
  for (const change of edit.documentChanges ?? []) {
    if (!('textDocument' in change)) continue // a file create/rename/delete
    for (const e of change.edits) {
      out.push({
        resource: monaco.Uri.parse(change.textDocument.uri),
        textEdit: { range: toMonacoRange(e.range), text: e.newText },
        versionId: undefined
      })
    }
  }

  return out
}

function toMonacoSymbol(symbol: DocumentSymbol | SymbolInformation): monaco.languages.DocumentSymbol {
  // DocumentSymbol nests and carries its own range; SymbolInformation is flat
  // and wraps a Location.
  if ('location' in symbol) {
    return {
      name: symbol.name,
      detail: '',
      kind: SYMBOL_KIND[symbol.kind] ?? monaco.languages.SymbolKind.Variable,
      tags: [],
      range: toMonacoRange(symbol.location.range),
      selectionRange: toMonacoRange(symbol.location.range),
      children: []
    }
  }

  return {
    name: symbol.name,
    detail: symbol.detail ?? '',
    kind: SYMBOL_KIND[symbol.kind] ?? monaco.languages.SymbolKind.Variable,
    tags: [],
    range: toMonacoRange(symbol.range),
    selectionRange: toMonacoRange(symbol.selectionRange),
    children: (symbol.children ?? []).map(toMonacoSymbol)
  }
}

// --------------------------------------------------------- response types

interface TextEdit {
  range: LspRange
  newText: string
}

interface LspLocation {
  uri: string
  range: LspRange
}

interface LspLocationLink {
  targetUri: string
  targetSelectionRange: LspRange
}

type LocationResponse = LspLocation | LspLocation[] | LspLocationLink[] | null

interface CompletionItem {
  label: string
  kind?: number
  detail?: string
  documentation?: string | { kind?: string; value: string }
  sortText?: string
  filterText?: string
  preselect?: boolean
  insertText?: string
  insertTextFormat?: number
  textEdit?: { range: LspRange; newText: string }
  additionalTextEdits?: TextEdit[]
}

type CompletionResponse = CompletionItem[] | { isIncomplete?: boolean; items?: CompletionItem[] }

interface HoverResponse {
  contents:
    | string
    | { kind?: string; value: string }
    | { language?: string; value: string }
    | Array<string | { kind?: string; value: string } | { language?: string; value: string }>
  range?: LspRange
}

interface SignatureHelpResponse {
  signatures: Array<{
    label: string
    documentation?: string | { kind?: string; value: string }
    parameters?: Array<{ label: string; documentation?: string | { kind?: string; value: string } }>
  }>
  activeSignature?: number
  activeParameter?: number
}

interface WorkspaceEdit {
  changes?: Record<string, TextEdit[]>
  documentChanges?: Array<{ textDocument: { uri: string; version?: number }; edits: TextEdit[] }>
}

interface CodeAction {
  title: string
  kind?: string
  isPreferred?: boolean
  edit?: WorkspaceEdit
}

interface DocumentSymbol {
  name: string
  detail?: string
  kind: number
  range: LspRange
  selectionRange: LspRange
  children?: DocumentSymbol[]
}

interface SymbolInformation {
  name: string
  kind: number
  location: { uri: string; range: LspRange }
}
