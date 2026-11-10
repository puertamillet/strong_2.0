import { useLocation, useNavigate, type Location } from 'react-router-dom'

/**
 * Some routes open as sheets over a tab instead of replacing it. The tab behind is
 * kept in the navigation state; when a sheet is opened directly (after a reload),
 * it opens over its default tab.
 */
export interface SheetState {
  background?: Location
}

export function sheetBackground(pathname: string): string | null {
  if (pathname.startsWith('/workout/') || pathname.startsWith('/templates/')) return '/'
  if (/^\/history\/[^/]+$/.test(pathname)) return '/history'
  if (/^\/exercises\/[^/]+$/.test(pathname)) return '/exercises'
  return null
}

/** Opens a sheet over the current tab (or over the same tab as the current sheet). */
export function useOpenSheet() {
  const navigate = useNavigate()
  const location = useLocation()
  return (to: string, options: { replace?: boolean } = {}) => {
    const background = (location.state as SheetState | null)?.background ?? location
    navigate(to, { state: { background } satisfies SheetState, replace: options.replace })
  }
}

/** Closes the current sheet: back to what was underneath, or to its default tab. */
export function useCloseSheet() {
  const navigate = useNavigate()
  const location = useLocation()
  return () => {
    if ((location.state as SheetState | null)?.background) navigate(-1)
    else navigate(sheetBackground(location.pathname) ?? '/', { replace: true })
  }
}
