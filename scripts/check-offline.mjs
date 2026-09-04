#!/usr/bin/env node
/**
 * Static audit of the offline guarantee.
 *
 * The runtime guard in src/main/offline.ts is what actually stops network
 * traffic. This script catches a different class of problem, before it ships:
 *
 *   1. A network call introduced into our own source. The runtime guard would
 *      cancel it, so it would not leak -- it would just be a silently broken
 *      feature. Better to fail the build.
 *
 *   2. A new remote host appearing in the built bundle. The bundle already
 *      contains ~2000 documentation URLs across ~70 hosts -- MDN links in
 *      TypeScript's DOM typings, references in the CSS/HTML/JSON language
 *      data, XML namespace identifiers. All are strings shown in hover
 *      tooltips or compared as opaque ids, and none is ever dereferenced.
 *
 *      Rather than hand-classify them (which would break on every Monaco
 *      update), the known set is recorded in scripts/offline-baseline.json.
 *      The check fails when a host appears that is NOT in that baseline, so
 *      a dependency that starts talking to a real endpoint shows up as a
 *      reviewable diff. Regenerate deliberately with:
 *
 *          node scripts/check-offline.mjs --update-baseline
 *
 * Run with: npm run check:offline
 */

import { readdir, readFile, stat, writeFile } from 'node:fs/promises'
import { join, relative } from 'node:path'

const ROOT = process.cwd()

// ---------------------------------------------------------------- check 1

/**
 * Network APIs. Written as call sites (`fetch(`, `new WebSocket(`) rather than
 * bare identifiers so that a comment or a string mentioning the name -- which
 * offline.ts and the tests both do -- is not a false positive.
 */
const NETWORK_CALLS = [
  { pattern: /(?<![\w.])fetch\s*\(/, name: 'fetch()' },
  { pattern: /new\s+WebSocket\s*\(/, name: 'new WebSocket()' },
  { pattern: /new\s+XMLHttpRequest\s*\(/, name: 'new XMLHttpRequest()' },
  { pattern: /new\s+EventSource\s*\(/, name: 'new EventSource()' },
  { pattern: /navigator\s*\.\s*sendBeacon\s*\(/, name: 'navigator.sendBeacon()' },
  { pattern: /from\s+['"](?:node:)?(?:http|https|net|dgram|tls)['"]/, name: 'node network module' },
  { pattern: /require\s*\(\s*['"](?:node:)?(?:http|https|net|dgram|tls)['"]\s*\)/, name: 'node network module' },
  { pattern: /shell\s*\.\s*openExternal\s*\(/, name: 'shell.openExternal()' }
]

/**
 * offline.ts is allowed to name openExternal: it holds the deliberately
 * disabled branch, guarded by a flag that is never turned on.
 */
const SOURCE_EXEMPT = [/src[/\\]main[/\\]offline\.ts$/]

// ---------------------------------------------------------------- check 2

const BASELINE_FILE = join(ROOT, 'scripts', 'offline-baseline.json')

const URL_PATTERN = /https?:\/\/[^\s"'`)\\<>\]},;]+/g

async function* walk(dir, filter) {
  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue
      yield* walk(full, filter)
    } else if (entry.isFile() && filter(full)) {
      yield full
    }
  }
}

function isComment(line) {
  const trimmed = line.trimStart()
  return trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')
}

// ------------------------------------------------------------------ run

let failed = false

// --- check 1: no network calls in our own source -------------------------

const sourceFindings = []
const isSource = (f) => /\.(ts|tsx|mjs|js)$/.test(f)

for await (const file of walk(join(ROOT, 'src'), isSource)) {
  if (SOURCE_EXEMPT.some((re) => re.test(file))) continue

  const content = await readFile(file, 'utf8')
  const lines = content.split('\n')

  for (let i = 0; i < lines.length; i++) {
    if (isComment(lines[i])) continue
    for (const { pattern, name } of NETWORK_CALLS) {
      if (pattern.test(lines[i])) {
        sourceFindings.push({ file: relative(ROOT, file), line: i + 1, name, text: lines[i].trim() })
      }
    }
  }
}

if (sourceFindings.length > 0) {
  failed = true
  console.error(`✗ Network API used in source (${sourceFindings.length}):\n`)
  for (const f of sourceFindings) {
    console.error(`  ${f.name}  ${f.file}:${f.line}`)
    console.error(`    ${f.text.slice(0, 100)}\n`)
  }
} else {
  console.log('✓ No network API call sites in src/.')
}

// --- check 2: no unexpected hosts in the built bundle --------------------

const OUT = join(ROOT, 'out')
const isBundle = (f) => /\.(js|css|html)$/.test(f) && !/\.map$/.test(f)

const hosts = new Map()
let scanned = 0

for await (const file of walk(OUT, isBundle)) {
  const info = await stat(file)
  if (info.size > 128 * 1024 * 1024) continue

  let content
  try {
    content = await readFile(file, 'utf8')
  } catch {
    continue
  }
  scanned++

  for (const match of content.matchAll(URL_PATTERN)) {
    let host
    try {
      host = new URL(match[0]).hostname
    } catch {
      continue
    }
    if (!hosts.has(host)) {
      hosts.set(host, { host, example: match[0], file: relative(ROOT, file), count: 0 })
    }
    hosts.get(host).count++
  }
}

if (scanned === 0) {
  console.error('✗ No built files were scanned. Run `npm run build` first.')
  process.exit(1)
}

const found = [...hosts.keys()].sort()

if (process.argv.includes('--update-baseline')) {
  await writeFile(
    BASELINE_FILE,
    JSON.stringify(
      {
        comment:
          'Hosts appearing as documentation or namespace strings in vendored ' +
          'language data. None is ever fetched. Regenerate with: node ' +
          'scripts/check-offline.mjs --update-baseline',
        generated: new Date().toISOString().slice(0, 10),
        hosts: found
      },
      null,
      2
    ) + '\n',
    'utf8'
  )
  console.log(`✓ Baseline written with ${found.length} host(s).`)
  process.exit(0)
}

let baseline = { hosts: [] }
try {
  baseline = JSON.parse(await readFile(BASELINE_FILE, 'utf8'))
} catch {
  console.error(`✗ Missing ${relative(ROOT, BASELINE_FILE)}. Generate it with --update-baseline.`)
  process.exit(1)
}

const known = new Set(baseline.hosts ?? [])
const added = found.filter((host) => !known.has(host))

if (added.length > 0) {
  failed = true
  console.error(`\n✗ ${added.length} host(s) not in the baseline:\n`)
  for (const host of added) {
    const h = hosts.get(host)
    console.error(`  ${host}  (${h.count} occurrence(s))`)
    console.error(`    ${h.example.slice(0, 110)}`)
    console.error(`    first seen in ${h.file}\n`)
  }
  console.error('Confirm each is documentation and never fetched, then re-run with')
  console.error('--update-baseline and commit the change so it is reviewable.')
} else {
  console.log(
    `✓ ${found.length} host(s) across ${scanned} built files, all in the baseline (none fetched).`
  )
}

process.exit(failed ? 1 : 0)
