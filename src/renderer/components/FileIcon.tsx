/**
 * File and folder icons.
 *
 * A tree where every row carries the same grey glyph is hard to scan: you end
 * up reading every filename. Colour by language and a handful of category
 * shapes let you find the file you want by shape and hue before you read
 * anything.
 *
 * Colour is never the only signal -- the filename is always there, and the
 * category shapes differ -- so this stays legible without colour vision.
 */

import { languageIdFor } from '@shared/languages.js'

/**
 * Language -> accent colour. Values are chosen to stay legible on both the
 * dark and light surfaces, so they are mid-tone rather than saturated.
 */
const LANGUAGE_COLOR: Record<string, string> = {
  typescript: '#4d9fff',
  typescriptreact: '#4d9fff',
  javascript: '#e2b341',
  python: '#5ec9d8',
  rust: '#e08a5a',
  go: '#5ec9d8',
  c: '#8fa3c9',
  cpp: '#8fa3c9',
  java: '#e08a5a',
  csharp: '#a98fdb',
  ruby: '#f0625d',
  php: '#a98fdb',
  shell: '#4ec9a5',
  lua: '#6c8fe0',
  swift: '#e08a5a',
  kotlin: '#a98fdb',
  dart: '#5ec9d8',
  elixir: '#a98fdb',
  haskell: '#a98fdb',
  scala: '#f0625d',
  julia: '#a98fdb',
  r: '#6c8fe0',
  perl: '#6c8fe0',
  zig: '#e2b341',

  html: '#e0785a',
  css: '#6c8fe0',
  scss: '#e07ba8',
  less: '#6c8fe0',

  json: '#e2b341',
  yaml: '#f0625d',
  toml: '#e08a5a',
  ini: '#9aa4b2',
  xml: '#8fa3c9',
  sql: '#5ec9d8',
  graphql: '#e07ba8',
  proto: '#5ec9d8',

  markdown: '#8fa3c9',
  latex: '#4ec9a5',
  restructuredtext: '#8fa3c9',
  dockerfile: '#4d9fff',
  makefile: '#4ec9a5',
  cmake: '#4ec9a5',
  ignore: '#6b7484',
  'go-mod': '#5ec9d8',
  plaintext: '#7a8494'
}

/** Broad shape families, so the icon differs by more than colour alone. */
type Shape = 'code' | 'markup' | 'data' | 'config' | 'doc' | 'binary'

const SHAPE_BY_LANGUAGE: Record<string, Shape> = {
  html: 'markup',
  xml: 'markup',
  markdown: 'doc',
  restructuredtext: 'doc',
  latex: 'doc',
  bibtex: 'doc',
  plaintext: 'doc',
  json: 'data',
  yaml: 'data',
  toml: 'data',
  sql: 'data',
  ini: 'config',
  dockerfile: 'config',
  makefile: 'config',
  cmake: 'config',
  ignore: 'config',
  'go-mod': 'config'
}

const BINARY_EXTENSIONS = new Set([
  'png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'ico', 'avif', 'bmp',
  'pdf', 'zip', 'gz', 'tar', 'xz', 'zst', '7z', 'rar',
  'mp3', 'wav', 'flac', 'ogg', 'mp4', 'mkv', 'mov', 'webm',
  'ttf', 'otf', 'woff', 'woff2', 'so', 'dylib', 'dll', 'exe', 'bin', 'wasm'
])

function shapeFor(name: string, languageId: string): Shape {
  const ext = name.slice(name.lastIndexOf('.') + 1).toLowerCase()
  if (BINARY_EXTENSIONS.has(ext)) return 'binary'
  return SHAPE_BY_LANGUAGE[languageId] ?? 'code'
}

interface Props {
  name: string
  size?: number
}

export function FileIcon({ name, size = 14 }: Props): React.ReactElement {
  const languageId = languageIdFor(name)
  const color = LANGUAGE_COLOR[languageId] ?? '#7a8494'
  const shape = shapeFor(name, languageId)

  const common = {
    width: size,
    height: size,
    viewBox: '0 0 16 16',
    fill: 'none',
    stroke: color,
    strokeWidth: 1.3,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
    focusable: 'false' as const
  }

  // A common page outline, with an inner mark that says what kind of file it
  // is. The page keeps every row visually aligned; the mark carries meaning.
  const page = <path d="M9.2 1.9H4.5a.9.9 0 0 0-.9.9v10.4a.9.9 0 0 0 .9.9h7a.9.9 0 0 0 .9-.9V5.1Zm0 0v3.2h3.2" />

  switch (shape) {
    case 'code':
      return (
        <svg {...common}>
          {page}
          {/* angle brackets: source */}
          <path d="M6.6 8.6 5.4 9.9l1.2 1.3M9.4 8.6l1.2 1.3-1.2 1.3" />
        </svg>
      )
    case 'markup':
      return (
        <svg {...common}>
          {page}
          <path d="M5.6 8.9h4.8M5.6 11.1h3.1" />
        </svg>
      )
    case 'data':
      return (
        <svg {...common}>
          {page}
          {/* braces: structured data */}
          <path d="M7 8.5c-.7 0-.7.7-.7 1.3s0 1.3-.7 1.3M9 8.5c.7 0 .7.7.7 1.3s0 1.3.7 1.3" />
        </svg>
      )
    case 'config':
      return (
        <svg {...common}>
          {page}
          <circle cx="8" cy="10" r="1.2" />
          <path d="M8 7.9v-.5M8 12.6v-.5M6.2 10h-.5M10.3 10h-.5" />
        </svg>
      )
    case 'doc':
      return (
        <svg {...common}>
          {page}
          <path d="M5.6 8.4h4.8M5.6 10.3h4.8M5.6 12.2h2.9" />
        </svg>
      )
    case 'binary':
      return (
        <svg {...common}>
          {page}
          {/* a small mountain: an opaque asset, not text */}
          <path d="M5.5 12.3l1.8-2.2 1.2 1.3 1-1.1 1.2 2z" />
        </svg>
      )
  }
}

interface FolderProps {
  open: boolean
  size?: number
  /** Folders whose name has a conventional meaning get a muted treatment. */
  name?: string
}

const MUTED_FOLDERS = new Set([
  'node_modules', '.git', 'dist', 'build', 'out', 'target',
  '.venv', 'venv', '__pycache__', '.cache', 'vendor', 'release'
])

export function FolderIconFor({ open, size = 14, name }: FolderProps): React.ReactElement {
  // Build output and dependency folders are rarely what you are looking for,
  // so they recede instead of competing with your own source directories.
  const color = name && MUTED_FOLDERS.has(name) ? 'var(--text-muted)' : '#6c8fe0'

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke={color}
      strokeWidth={1.3}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {open ? (
        <path d="M2.2 12.6V4.1h3.9l1.3 1.7h5.1v1.6M2.2 12.6l1.8-4.7h10l-1.8 4.7z" />
      ) : (
        <path d="M2.2 12.6V4.1h3.9l1.3 1.7h6.4v6.8z" />
      )}
    </svg>
  )
}
