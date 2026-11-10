import { FIGURES, type FigureSex, type FigureView } from '../data/bodyFigure'
import type { Muscle } from '../lib/catalog'

interface Props {
  primary: readonly Muscle[]
  secondary: readonly Muscle[]
  sex: FigureSex
}

type Level = 'primary' | 'secondary' | 'body' | 'hair'

/**
 * The body from the front and from the back, with the muscles the exercise works most in the accent
 * colour and the ones that also work in a lighter shade. Its own module (with the drawings, ~130 KB)
 * so it only loads when an exercise page opens. The muscles are also listed in text next to it.
 */
export default function BodyFigure({ primary, secondary, sex }: Props) {
  const level = (muscles: string): Level => {
    if (muscles === '~') return 'hair'
    const list = muscles.split('|') as Muscle[]
    if (list.some((m) => primary.includes(m))) return 'primary'
    return list.some((m) => secondary.includes(m)) ? 'secondary' : 'body'
  }
  return (
    <div className="body-figure" aria-hidden="true">
      <BodyView view={FIGURES[sex].front} level={level} caption="Delante" />
      <BodyView view={FIGURES[sex].back} level={level} caption="Detrás" />
    </div>
  )
}

function BodyView({ view, level, caption }: { view: FigureView; level: (muscles: string) => Level; caption: string }) {
  return (
    <figure>
      <svg viewBox={view.viewBox} className="body-view">
        <path d={view.outline} className="body-outline" />
        {view.regions.map(([muscles, d], i) => (
          <path key={i} d={d} className={`body-${level(muscles)}`} />
        ))}
      </svg>
      <figcaption className="muted small-text">{caption}</figcaption>
    </figure>
  )
}
