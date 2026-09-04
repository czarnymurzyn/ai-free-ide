/**
 * Extension -> language id mapping.
 *
 * Ids match Monaco's built-in language ids where one exists, so the editor
 * picks up highlighting for free, and they double as the LSP `languageId`
 * sent in textDocument/didOpen.
 */

const BY_EXTENSION: Record<string, string> = {
  // web
  js: 'javascript', mjs: 'javascript', cjs: 'javascript', jsx: 'javascript',
  ts: 'typescript', mts: 'typescript', cts: 'typescript', tsx: 'typescriptreact',
  html: 'html', htm: 'html', xhtml: 'html', vue: 'html', svelte: 'html',
  css: 'css', scss: 'scss', less: 'less',
  json: 'json', jsonc: 'json', json5: 'json', webmanifest: 'json',

  // systems
  c: 'c', h: 'c',
  cc: 'cpp', cpp: 'cpp', cxx: 'cpp', hpp: 'cpp', hh: 'cpp', hxx: 'cpp', ino: 'cpp',
  rs: 'rust',
  go: 'go',
  zig: 'zig',
  swift: 'swift',
  m: 'objective-c', mm: 'objective-c',

  // jvm / .net
  java: 'java', kt: 'kotlin', kts: 'kotlin', scala: 'scala', groovy: 'groovy',
  cs: 'csharp', fs: 'fsharp', vb: 'vb',

  // scripting
  py: 'python', pyi: 'python', pyw: 'python',
  rb: 'ruby', erb: 'ruby', gemspec: 'ruby',
  php: 'php',
  pl: 'perl', pm: 'perl',
  lua: 'lua',
  r: 'r',
  jl: 'julia',
  dart: 'dart',
  ex: 'elixir', exs: 'elixir',
  erl: 'erlang', hrl: 'erlang',
  hs: 'haskell',
  clj: 'clojure', cljs: 'clojure', edn: 'clojure',
  sh: 'shell', bash: 'shell', zsh: 'shell', fish: 'shell', ksh: 'shell',
  ps1: 'powershell', psm1: 'powershell',

  // data / config
  yaml: 'yaml', yml: 'yaml',
  toml: 'toml',
  ini: 'ini', cfg: 'ini', conf: 'ini', properties: 'ini', env: 'ini',
  xml: 'xml', xsd: 'xml', xsl: 'xml', svg: 'xml', plist: 'xml',
  csv: 'plaintext', tsv: 'plaintext',
  sql: 'sql',
  graphql: 'graphql', gql: 'graphql',
  proto: 'proto',

  // docs
  md: 'markdown', markdown: 'markdown', mdx: 'markdown',
  rst: 'restructuredtext',
  tex: 'latex', bib: 'bibtex',
  txt: 'plaintext', log: 'plaintext'
}

/** Files whose whole name (not extension) determines the language. */
const BY_FILENAME: Record<string, string> = {
  dockerfile: 'dockerfile',
  containerfile: 'dockerfile',
  makefile: 'makefile',
  gnumakefile: 'makefile',
  cmakelists: 'cmake',
  'cmakelists.txt': 'cmake',
  '.gitignore': 'ignore',
  '.dockerignore': 'ignore',
  '.npmignore': 'ignore',
  '.gitattributes': 'ini',
  '.editorconfig': 'ini',
  '.bashrc': 'shell',
  '.zshrc': 'shell',
  '.profile': 'shell',
  'go.mod': 'go-mod',
  'go.sum': 'plaintext',
  gemfile: 'ruby',
  rakefile: 'ruby',
  vagrantfile: 'ruby',
  'cargo.lock': 'toml',
  'package-lock.json': 'json',
  'tsconfig.json': 'json',
  'jsconfig.json': 'json'
}

export function languageIdFor(filePath: string): string {
  const base = filePath.split('/').pop() ?? filePath
  const lower = base.toLowerCase()

  const byName = BY_FILENAME[lower]
  if (byName) return byName

  // A dotfile with no further dots (.bashrc) has no extension to speak of.
  const lastDot = lower.lastIndexOf('.')
  if (lastDot <= 0) return 'plaintext'

  const ext = lower.slice(lastDot + 1)
  return BY_EXTENSION[ext] ?? 'plaintext'
}

/** Extensions we refuse to open in the text editor. */
const BINARY_EXTENSIONS = new Set([
  'png', 'jpg', 'jpeg', 'gif', 'bmp', 'ico', 'webp', 'avif', 'tiff',
  'pdf', 'zip', 'gz', 'bz2', 'xz', 'zst', 'tar', '7z', 'rar',
  'mp3', 'wav', 'flac', 'ogg', 'opus', 'm4a',
  'mp4', 'mkv', 'mov', 'avi', 'webm',
  'so', 'dylib', 'dll', 'exe', 'bin', 'o', 'a', 'node', 'wasm',
  'ttf', 'otf', 'woff', 'woff2', 'eot',
  'sqlite', 'db', 'pyc', 'class', 'jar'
])

export function isProbablyBinary(filePath: string): boolean {
  const base = (filePath.split('/').pop() ?? '').toLowerCase()
  const lastDot = base.lastIndexOf('.')
  if (lastDot <= 0) return false
  return BINARY_EXTENSIONS.has(base.slice(lastDot + 1))
}
