/**
 * Monaco bootstrap.
 *
 * The critical detail for this project: Monaco's language workers are imported
 * as local Vite worker bundles. The usual `MonacoEnvironment.getWorkerUrl`
 * pattern points at a CDN; that would be both a network request and a silent
 * failure here, since the offline guard would cancel it and the editor would
 * degrade to plain highlighting with no explanation.
 */

import * as monaco from 'monaco-editor'
// monaco-editor's exports map is `"./*": "./esm/vs/*.js"`, so subpaths are
// written without the `esm/vs` prefix. Each is a local Vite worker bundle.
import editorWorker from 'monaco-editor/editor/editor.worker?worker'
import cssWorker from 'monaco-editor/language/css/css.worker?worker'
import htmlWorker from 'monaco-editor/language/html/html.worker?worker'
import jsonWorker from 'monaco-editor/language/json/json.worker?worker'
import tsWorker from 'monaco-editor/language/typescript/ts.worker?worker'
import { DARK_THEME, LIGHT_THEME } from './themes.js'

let initialised = false

export function setupMonaco(): void {
  if (initialised) return
  initialised = true

  self.MonacoEnvironment = {
    getWorker(_workerId: string, label: string): Worker {
      switch (label) {
        case 'json':
          return new jsonWorker()
        case 'css':
        case 'scss':
        case 'less':
          return new cssWorker()
        case 'html':
        case 'handlebars':
        case 'razor':
          return new htmlWorker()
        case 'typescript':
        case 'javascript':
          return new tsWorker()
        default:
          return new editorWorker()
      }
    }
  }

  monaco.editor.defineTheme('ide-dark', DARK_THEME)
  monaco.editor.defineTheme('ide-light', LIGHT_THEME)

  // Monaco's bundled TypeScript service only sees the current file, so on a
  // real project it reports "Cannot find module" for every import. Syntax
  // checking is still useful and correct, so keep that and drop the semantic
  // half; a real typescript-language-server, when installed, supplies proper
  // project-wide diagnostics through the LSP bridge.
  // Monaco 0.56 moved these off `languages.typescript` to a top-level
  // `typescript` namespace; the old path is a deprecation stub.
  monaco.typescript.typescriptDefaults.setDiagnosticsOptions({
    noSemanticValidation: true,
    noSyntaxValidation: false
  })
  monaco.typescript.javascriptDefaults.setDiagnosticsOptions({
    noSemanticValidation: true,
    noSyntaxValidation: false
  })

  monaco.typescript.typescriptDefaults.setCompilerOptions({
    target: monaco.typescript.ScriptTarget.ESNext,
    allowNonTsExtensions: true,
    moduleResolution: monaco.typescript.ModuleResolutionKind.NodeJs,
    jsx: monaco.typescript.JsxEmit.ReactJSX
  })
}

/** Shared editor options, derived from user settings. */
export function editorOptions(settings: {
  'editor.fontFamily': string
  'editor.fontSize': number
  'editor.tabSize': number
  'editor.insertSpaces': boolean
  'editor.wordWrap': 'on' | 'off'
  'editor.minimap': boolean
  'editor.renderWhitespace': 'none' | 'boundary' | 'all'
}): monaco.editor.IStandaloneEditorConstructionOptions {
  return {
    fontFamily: settings['editor.fontFamily'],
    fontSize: settings['editor.fontSize'],
    tabSize: settings['editor.tabSize'],
    insertSpaces: settings['editor.insertSpaces'],
    wordWrap: settings['editor.wordWrap'],
    minimap: { enabled: settings['editor.minimap'], renderCharacters: false },
    renderWhitespace: settings['editor.renderWhitespace'],
    automaticLayout: true,
    scrollBeyondLastLine: false,
    smoothScrolling: true,
    cursorBlinking: 'smooth',
    cursorSmoothCaretAnimation: 'on',
    renderLineHighlight: 'all',
    bracketPairColorization: { enabled: true },
    guides: { bracketPairs: 'active', indentation: true },
    stickyScroll: { enabled: true },
    padding: { top: 8, bottom: 8 },
    fontLigatures: true,
    linkedEditing: true,
    occurrencesHighlight: 'singleFile',
    scrollbar: {
      verticalScrollbarSize: 10,
      horizontalScrollbarSize: 10,
      useShadows: false
    },
    suggest: {
      showWords: true,
      showStatusBar: true,
      insertMode: 'insert'
    },
    quickSuggestions: { other: true, comments: false, strings: false },
    // The editor must never offer a network- or model-backed action.
    inlineSuggest: { enabled: false },
    codeLens: false
  }
}

export { monaco }
