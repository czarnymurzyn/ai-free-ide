/**
 * Known language servers.
 *
 * Every entry is a binary the user has installed themselves. The IDE looks
 * these up on PATH and uses whatever it finds -- it never downloads, installs,
 * suggests an install command, or contacts an extension registry.
 *
 * A server not listed here can still be used by setting an explicit path under
 * `lsp.serverPaths` in settings.json.
 */

import type { LanguageServerSpec } from '../../shared/types.js'

export const SERVER_SPECS: LanguageServerSpec[] = [
  {
    id: 'typescript',
    label: 'TypeScript / JavaScript',
    languages: ['typescript', 'typescriptreact', 'javascript'],
    command: 'typescript-language-server',
    args: ['--stdio']
  },
  {
    id: 'pyright',
    label: 'Python (Pyright)',
    languages: ['python'],
    command: 'pyright-langserver',
    args: ['--stdio']
  },
  {
    id: 'pylsp',
    label: 'Python (pylsp)',
    languages: ['python'],
    command: 'pylsp',
    args: []
  },
  {
    id: 'ruff',
    label: 'Python (Ruff)',
    languages: ['python'],
    command: 'ruff',
    args: ['server']
  },
  {
    id: 'clangd',
    label: 'C / C++',
    languages: ['c', 'cpp', 'objective-c'],
    command: 'clangd',
    args: ['--background-index', '--clang-tidy']
  },
  {
    id: 'rust-analyzer',
    label: 'Rust',
    languages: ['rust'],
    command: 'rust-analyzer',
    args: []
  },
  {
    id: 'gopls',
    label: 'Go',
    languages: ['go'],
    command: 'gopls',
    args: []
  },
  {
    id: 'lua',
    label: 'Lua',
    languages: ['lua'],
    command: 'lua-language-server',
    args: []
  },
  {
    id: 'bash',
    label: 'Shell',
    languages: ['shell'],
    command: 'bash-language-server',
    args: ['start']
  },
  {
    id: 'json',
    label: 'JSON',
    languages: ['json'],
    command: 'vscode-json-languageserver',
    args: ['--stdio']
  },
  {
    id: 'yaml',
    label: 'YAML',
    languages: ['yaml'],
    command: 'yaml-language-server',
    args: ['--stdio']
  },
  {
    id: 'html',
    label: 'HTML',
    languages: ['html'],
    command: 'vscode-html-language-server',
    args: ['--stdio']
  },
  {
    id: 'css',
    label: 'CSS / SCSS / Less',
    languages: ['css', 'scss', 'less'],
    command: 'vscode-css-language-server',
    args: ['--stdio']
  },
  {
    id: 'texlab',
    label: 'LaTeX',
    languages: ['latex', 'bibtex'],
    command: 'texlab',
    args: []
  },
  {
    id: 'jdtls',
    label: 'Java',
    languages: ['java'],
    command: 'jdtls',
    args: []
  },
  {
    id: 'omnisharp',
    label: 'C#',
    languages: ['csharp'],
    command: 'omnisharp',
    args: ['-lsp']
  },
  {
    id: 'zls',
    label: 'Zig',
    languages: ['zig'],
    command: 'zls',
    args: []
  }
]

/**
 * When two servers claim the same language (pyright, pylsp and ruff all handle
 * Python), the first one found in this order wins.
 */
export const PREFERENCE_ORDER = ['pyright', 'ruff', 'pylsp']

export function specsForLanguage(languageId: string): LanguageServerSpec[] {
  const matches = SERVER_SPECS.filter((spec) => spec.languages.includes(languageId))
  return matches.sort((a, b) => {
    const ai = PREFERENCE_ORDER.indexOf(a.id)
    const bi = PREFERENCE_ORDER.indexOf(b.id)
    return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi)
  })
}
