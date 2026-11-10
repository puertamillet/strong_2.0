import { useLiveQuery } from 'dexie-react-hooks'
import { HashRouter, NavLink, Route, Routes, useLocation, type Location } from 'react-router-dom'
import { DialogHost } from './components/Dialog'
import { Icon } from './components/icons'
import { WorkoutBar } from './components/WorkoutBar'
import { useKeepAwakeSetting, useScreenWakeLock } from './lib/keepAwake'
import { useRestAlarm } from './lib/restTimer'
import { sheetBackground, type SheetState } from './lib/sheets'
import { getActiveWorkout } from './lib/workouts'
import { ExerciseDetailRoute } from './pages/ExerciseDetailPage'
import { ExercisesPage } from './pages/ExercisesPage'
import { HistoryPage } from './pages/HistoryPage'
import { SettingsPage } from './pages/SettingsPage'
import { StartPage } from './pages/StartPage'
import { TemplateRoute } from './sheets/TemplateSheet'
import { WorkoutRoute } from './sheets/WorkoutSheet'
import { WorkoutSummaryRoute } from './sheets/WorkoutSummarySheet'

function TabBar() {
  return (
    <nav className="tab-bar">
      <NavLink to="/" end>
        <Icon name="train" />
        Entrenar
      </NavLink>
      <NavLink to="/history">
        <Icon name="history" />
        Historial
      </NavLink>
      <NavLink to="/exercises">
        <Icon name="exercises" />
        Ejercicios
      </NavLink>
      <NavLink to="/settings">
        <Icon name="settings" />
        Ajustes
      </NavLink>
    </nav>
  )
}

/**
 * Tabs are pages; workouts, templates, past workouts and exercises open as sheets
 * over the tab they were opened from (or over their default tab after a reload).
 */
function AppRoutes() {
  const location = useLocation()
  const sheetTab = sheetBackground(location.pathname)
  const background: Location =
    (location.state as SheetState | null)?.background ??
    (sheetTab ? { ...location, pathname: sheetTab, state: null } : location)

  return (
    <>
      <main className="app">
        <Routes location={background}>
          <Route path="/" element={<StartPage />} />
          <Route path="/history" element={<HistoryPage />} />
          <Route path="/exercises" element={<ExercisesPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="*" element={<StartPage />} />
        </Routes>
      </main>
      {sheetTab && (
        <Routes>
          <Route path="/workout/:id" element={<WorkoutRoute />} />
          <Route path="/templates/:id" element={<TemplateRoute />} />
          <Route path="/history/:id" element={<WorkoutSummaryRoute />} />
          <Route path="/exercises/:id" element={<ExerciseDetailRoute />} />
        </Routes>
      )}
      <WorkoutBar />
      <TabBar />
    </>
  )
}

export default function App() {
  const keepAwake = useKeepAwakeSetting()
  const training = useLiveQuery(async () => (await getActiveWorkout()) !== undefined, [])
  useScreenWakeLock(keepAwake && training === true)
  useRestAlarm()

  return (
    <HashRouter>
      <AppRoutes />
      <DialogHost />
    </HashRouter>
  )
}
