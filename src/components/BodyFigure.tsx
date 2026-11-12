import { FIGURES, type FigureSex, type FigureView } from '../data/bodyFigure'
import type { RegionPaint } from '../lib/bodyFigure'
import type { Muscle } from '../lib/catalog'

interface Props {
  sex: FigureSex
  /** The class of each muscle region (see lib/bodyFigure). */
  paint: RegionPaint
}

/**
 * The body from the front and from the back, with its muscles painted: those of an exercise on its
 * page, the sets of each muscle in a week on the dashboard. Its own module (with the drawings,
 * ~130 KB) so it only loads when shown. The muscles are also listed in text next to it.
 */
export default function BodyFigure({ sex, paint }: Props) {
  const regionClass = (muscles: string) => {
    if (muscles === '~') return 'body-hair'
    return muscles ? paint(muscles.split('|') as Muscle[]) : 'body-body'
  }
  return (
    <div className="body-figure" aria-hidden="true">
      <BodyView view={FIGURES[sex].front} regionClass={regionClass} caption="Delante" />
      <BodyView view={FIGURES[sex].back} regionClass={regionClass} caption="Detrás" />
    </div>
  )
}

function BodyView({ view, regionClass, caption }: { view: FigureView; regionClass: (muscles: string) => string; caption: string }) {
  return (
    <figure>
      <svg viewBox={view.viewBox} className="body-view">
        <path d={view.outline} className="body-outline" />
        {view.regions.map(([muscles, d], i) => (
          <path key={i} d={d} className={regionClass(muscles)} />
        ))}
      </svg>
      <figcaption className="muted small-text">{caption}</figcaption>
    </figure>
  )
}
