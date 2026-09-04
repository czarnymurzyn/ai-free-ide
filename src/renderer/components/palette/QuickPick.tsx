/**
 * A single reusable quick-pick overlay.
 *
 * The command palette, file quick-open and branch picker are all the same
 * interaction -- filter a list, arrow through it, Enter to choose -- so they
 * share one component rather than three near-identical ones.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import './QuickPick.css'

export interface QuickPickItem {
  id: string
  label: string
  description?: string
  detail?: string
}

interface Props {
  items: QuickPickItem[]
  placeholder: string
  /** Prefills the input, e.g. '>' for the command palette. */
  initialQuery?: string
  onAccept(item: QuickPickItem): void
  onDismiss(): void
}

/** Cap the rendered list; scanning past ~500 rows is not a real workflow. */
const MAX_VISIBLE = 500

export function QuickPick({
  items,
  placeholder,
  initialQuery = '',
  onAccept,
  onDismiss
}: Props): React.ReactElement {
  const [query, setQuery] = useState(initialQuery)
  const [index, setIndex] = useState(0)
  const listRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [])

  const filtered = useMemo(() => {
    const trimmed = query.trim()
    if (!trimmed) return items.slice(0, MAX_VISIBLE)

    return items
      .map((item) => ({ item, score: fuzzyScore(trimmed, item.label, item.description) }))
      .filter((entry) => entry.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, MAX_VISIBLE)
      .map((entry) => entry.item)
  }, [items, query])

  // Reset the highlight whenever the result set changes under it.
  useEffect(() => {
    setIndex(0)
  }, [query])

  // Keep the highlighted row in view while arrowing through a long list.
  useEffect(() => {
    listRef.current
      ?.querySelector(`[data-index="${index}"]`)
      ?.scrollIntoView({ block: 'nearest' })
  }, [index])

  const onKeyDown = (event: React.KeyboardEvent): void => {
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault()
        setIndex((i) => Math.min(i + 1, filtered.length - 1))
        break
      case 'ArrowUp':
        event.preventDefault()
        setIndex((i) => Math.max(i - 1, 0))
        break
      case 'Home':
        event.preventDefault()
        setIndex(0)
        break
      case 'End':
        event.preventDefault()
        setIndex(filtered.length - 1)
        break
      case 'Enter': {
        event.preventDefault()
        const chosen = filtered[index]
        if (chosen) onAccept(chosen)
        break
      }
      case 'Escape':
        event.preventDefault()
        onDismiss()
        break
    }
  }

  return (
    <div className="quick-pick__backdrop" onMouseDown={onDismiss}>
      <div
        className="quick-pick"
        role="dialog"
        aria-modal="true"
        aria-label={placeholder}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <input
          ref={inputRef}
          type="text"
          className="quick-pick__input"
          placeholder={placeholder}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={onKeyDown}
          aria-label={placeholder}
          aria-autocomplete="list"
        />

        <div className="quick-pick__list" ref={listRef} role="listbox">
          {filtered.length === 0 ? (
            <p className="quick-pick__empty">No matching results</p>
          ) : (
            filtered.map((item, i) => (
              <div
                key={item.id}
                data-index={i}
                role="option"
                aria-selected={i === index}
                className={`quick-pick__item${i === index ? ' quick-pick__item--active' : ''}`}
                onMouseMove={() => setIndex(i)}
                onClick={() => onAccept(item)}
              >
                <div className="quick-pick__row">
                  <span className="quick-pick__label truncate">{item.label}</span>
                  {item.detail && <span className="quick-pick__detail">{item.detail}</span>}
                </div>
                {item.description && (
                  <div className="quick-pick__description truncate">{item.description}</div>
                )}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}

/**
 * Subsequence scoring, the same idea every editor's quick-open uses: the query
 * characters must appear in order, and matches that are contiguous or land on
 * a word boundary score higher, so "sp" ranks "SearchPanel" above "src/app".
 */
export function fuzzyScore(query: string, label: string, description?: string): number {
  const haystack = description ? `${label} ${description}` : label
  const needle = query.toLowerCase()
  const target = haystack.toLowerCase()

  // A plain substring hit is always the best kind of match.
  const direct = target.indexOf(needle)
  if (direct !== -1) {
    // Earlier and closer to a boundary is better.
    const boundaryBonus = direct === 0 || /[\s/_.-]/.test(target[direct - 1] ?? '') ? 40 : 0
    return 1000 - direct + boundaryBonus
  }

  let score = 0
  let targetIndex = 0
  let previousMatch = -2

  for (const char of needle) {
    const found = target.indexOf(char, targetIndex)
    if (found === -1) return 0

    score += 10
    if (found === previousMatch + 1) score += 8 // contiguous
    if (found === 0 || /[\s/_.-]/.test(target[found - 1] ?? '')) score += 12 // boundary

    previousMatch = found
    targetIndex = found + 1
  }

  // Prefer shorter targets when scores are otherwise close.
  return Math.max(1, score - Math.floor(target.length / 12))
}
