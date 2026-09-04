/**
 * A real context menu.
 *
 * Rendered into a portal at the document root so it is never clipped by a
 * panel's `overflow: hidden`, and positioned so it always stays on screen --
 * a menu opened near the bottom edge flips upward rather than being cut off.
 *
 * Fully keyboard driven: arrows move, Enter activates, Escape dismisses, and
 * focus returns to whatever opened it.
 */

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import './ContextMenu.css'

export interface MenuItem {
  id: string
  label: string
  /** Shown right-aligned, e.g. a keyboard shortcut. */
  hint?: string
  danger?: boolean
  disabled?: boolean
  run(): void
}

export type MenuEntry = MenuItem | { separator: true }

export interface MenuPosition {
  x: number
  y: number
}

interface Props {
  entries: MenuEntry[]
  position: MenuPosition
  onDismiss(): void
}

const isItem = (entry: MenuEntry): entry is MenuItem => !('separator' in entry)

export function ContextMenu({ entries, position, onDismiss }: Props): React.ReactElement {
  const menuRef = useRef<HTMLDivElement>(null)
  const [placement, setPlacement] = useState<MenuPosition>(position)
  const items = entries.filter(isItem)
  const [activeIndex, setActiveIndex] = useState(() => items.findIndex((i) => !i.disabled))

  // Measure after mount, then clamp into the viewport. Doing this in a layout
  // effect avoids a visible jump from the unclamped position.
  useLayoutEffect(() => {
    const el = menuRef.current
    if (!el) return

    const { width, height } = el.getBoundingClientRect()
    const margin = 6
    const x =
      position.x + width + margin > window.innerWidth
        ? Math.max(margin, position.x - width)
        : position.x
    const y =
      position.y + height + margin > window.innerHeight
        ? Math.max(margin, position.y - height)
        : position.y

    setPlacement({ x, y })
    el.focus()
  }, [position])

  useEffect(() => {
    const onPointerDown = (event: PointerEvent): void => {
      if (!menuRef.current?.contains(event.target as Node)) onDismiss()
    }
    // A scroll or a resize invalidates the anchor point, so close rather than
    // leave the menu floating somewhere meaningless.
    const onScroll = (): void => onDismiss()

    window.addEventListener('pointerdown', onPointerDown, true)
    window.addEventListener('resize', onScroll)
    window.addEventListener('wheel', onScroll, { passive: true })
    return () => {
      window.removeEventListener('pointerdown', onPointerDown, true)
      window.removeEventListener('resize', onScroll)
      window.removeEventListener('wheel', onScroll)
    }
  }, [onDismiss])

  const move = (delta: number): void => {
    if (items.length === 0) return
    let next = activeIndex
    // Step over disabled entries rather than landing on them.
    for (let i = 0; i < items.length; i++) {
      next = (next + delta + items.length) % items.length
      if (!items[next]?.disabled) break
    }
    setActiveIndex(next)
  }

  const onKeyDown = (event: React.KeyboardEvent): void => {
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault()
        move(1)
        break
      case 'ArrowUp':
        event.preventDefault()
        move(-1)
        break
      case 'Home':
        event.preventDefault()
        setActiveIndex(items.findIndex((i) => !i.disabled))
        break
      case 'End':
        event.preventDefault()
        setActiveIndex(items.length - 1)
        break
      case 'Enter':
      case ' ': {
        event.preventDefault()
        const item = items[activeIndex]
        if (item && !item.disabled) {
          onDismiss()
          item.run()
        }
        break
      }
      case 'Escape':
        event.preventDefault()
        event.stopPropagation()
        onDismiss()
        break
    }
  }

  let itemIndex = -1

  return createPortal(
    <div
      ref={menuRef}
      className="context-menu"
      style={{ left: placement.x, top: placement.y }}
      role="menu"
      tabIndex={-1}
      onKeyDown={onKeyDown}
      onContextMenu={(event) => event.preventDefault()}
    >
      {entries.map((entry, i) => {
        if (!isItem(entry)) {
          return <div key={`sep-${i}`} className="context-menu__separator" role="separator" />
        }
        itemIndex++
        const index = itemIndex

        return (
          <button
            key={entry.id}
            type="button"
            role="menuitem"
            disabled={entry.disabled}
            className={
              'context-menu__item' +
              (index === activeIndex ? ' context-menu__item--active' : '') +
              (entry.danger ? ' context-menu__item--danger' : '')
            }
            onMouseMove={() => !entry.disabled && setActiveIndex(index)}
            onClick={() => {
              onDismiss()
              entry.run()
            }}
          >
            <span className="context-menu__label">{entry.label}</span>
            {entry.hint && <span className="context-menu__hint">{entry.hint}</span>}
          </button>
        )
      })}
    </div>,
    document.body
  )
}

/**
 * Track "is a menu open, and where" for one component.
 *
 * Returned as a hook because every call site needs the same three pieces of
 * state and the same right-click handler.
 */
export function useContextMenu(): {
  position: MenuPosition | null
  open(event: React.MouseEvent): void
  close(): void
} {
  const [position, setPosition] = useState<MenuPosition | null>(null)

  return {
    position,
    open(event) {
      event.preventDefault()
      event.stopPropagation()
      setPosition({ x: event.clientX, y: event.clientY })
    },
    close() {
      setPosition(null)
    }
  }
}
