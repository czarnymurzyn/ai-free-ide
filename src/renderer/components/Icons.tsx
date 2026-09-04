/**
 * Inline SVG icons.
 *
 * Hand-drawn rather than pulled from an icon font or package: an icon font
 * would be another asset to bundle, and every hosted icon set is a network
 * request. These are 16x16 on a 16-unit grid, stroked with currentColor so
 * they follow the theme automatically.
 */

interface IconProps {
  size?: number
  className?: string
}

function svg(path: React.ReactNode, filled = false) {
  return function Icon({ size = 16, className }: IconProps): React.ReactElement {
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 16 16"
        fill={filled ? 'currentColor' : 'none'}
        stroke={filled ? 'none' : 'currentColor'}
        strokeWidth="1.3"
        strokeLinecap="round"
        strokeLinejoin="round"
        className={className}
        aria-hidden="true"
        focusable="false"
      >
        {path}
      </svg>
    )
  }
}

export const FilesIcon = svg(
  <>
    <path d="M2.5 3.2h4l1.2 1.6h5.8v7.9a.8.8 0 0 1-.8.8H3.3a.8.8 0 0 1-.8-.8Z" />
  </>
)

export const SearchIcon = svg(
  <>
    <circle cx="7" cy="7" r="4.2" />
    <path d="M10.2 10.2 13.5 13.5" />
  </>
)

export const GitIcon = svg(
  <>
    <circle cx="4.5" cy="3.6" r="1.8" />
    <circle cx="4.5" cy="12.4" r="1.8" />
    <circle cx="11.5" cy="8" r="1.8" />
    <path d="M4.5 5.4v5.2M6.3 3.6h2.4a1.4 1.4 0 0 1 1.4 1.4v1.4" />
  </>
)

export const ServerIcon = svg(
  <>
    <rect x="2.4" y="2.6" width="11.2" height="4.2" rx="1" />
    <rect x="2.4" y="9.2" width="11.2" height="4.2" rx="1" />
    <path d="M4.8 4.7h.01M4.8 11.3h.01" />
  </>
)

export const ChevronRight = svg(<path d="M6 3.5 10.5 8 6 12.5" />)
export const ChevronDown = svg(<path d="M3.5 6 8 10.5 12.5 6" />)

export const FileIcon = svg(
  <>
    <path d="M9 1.8H4.6a.9.9 0 0 0-.9.9v10.6a.9.9 0 0 0 .9.9h6.8a.9.9 0 0 0 .9-.9V4.8Z" />
    <path d="M9 1.8v3h3.3" />
  </>
)

export const FolderIcon = svg(
  <path d="M2 3.6h4.2l1.3 1.7h6.5v7.1H2Z" />
)

export const CloseIcon = svg(<path d="M4 4l8 8M12 4l-8 8" />)
export const PlusIcon = svg(<path d="M8 3.5v9M3.5 8h9" />)
export const SplitIcon = svg(
  <>
    <rect x="2.2" y="2.8" width="11.6" height="10.4" rx="1" />
    <path d="M8 2.8v10.4" />
  </>
)

export const TerminalIcon = svg(
  <>
    <rect x="1.8" y="2.6" width="12.4" height="10.8" rx="1" />
    <path d="M4.4 6.2 6.6 8l-2.2 1.8M8.4 10.2h3.2" />
  </>
)

export const WarningIcon = svg(
  <>
    <path d="M8 2.4 14.4 13H1.6Z" />
    <path d="M8 6.6v3M8 11.3h.01" />
  </>
)

export const ErrorIcon = svg(
  <>
    <circle cx="8" cy="8" r="5.8" />
    <path d="M8 5v3.4M8 10.6h.01" />
  </>
)

export const InfoIcon = svg(
  <>
    <circle cx="8" cy="8" r="5.8" />
    <path d="M8 7.4v3.4M8 5.2h.01" />
  </>
)

export const CheckIcon = svg(<path d="M3.2 8.4 6.4 11.6l6.4-7.2" />)
export const RefreshIcon = svg(
  <>
    <path d="M13.2 7a5.3 5.3 0 1 0-.6 3.4" />
    <path d="M13.4 3.4V7h-3.5" />
  </>
)

export const OfflineIcon = svg(
  <>
    <circle cx="8" cy="8" r="6" />
    <path d="M3.8 3.8l8.4 8.4" />
  </>
)

export const StageIcon = svg(<path d="M8 3.4v9.2M4.6 7.6 8 4.2l3.4 3.4" />)
export const UnstageIcon = svg(<path d="M8 12.6V3.4M4.6 8.4 8 11.8l3.4-3.4" />)
export const DiscardIcon = svg(
  <>
    <path d="M2.8 7.6a5.3 5.3 0 1 1 1.5 4" />
    <path d="M2.6 11.4V7.8h3.6" />
  </>
)
