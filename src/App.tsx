import { useLiveQuery } from 'dexie-react-hooks'
import { HashRouter, NavLink, Route, Routes, useLocation } from 'react-router-dom'
import { Icon } from './components/icons'
import { RestTimerBar } from './components/RestTimerBar'
import { useKeepAwakeSetting, useScreenWakeLock } from './lib/keepAwake'
import { getActiveWorkout } from './lib/workouts'
import { ExerciseDetailPage } from './pages/ExerciseDetailPage'
import { ExercisesPage } from './pages/ExercisesPage'
import { HistoryPage } from './pages/HistoryPage'
import { SettingsPage } from './pages/SettingsPage'
import { StartPage } from './pages/StartPage'
import { TemplateEditor } from './pages/TemplateEditor'
import { WorkoutPage } from './pages/WorkoutPage'

function TabBar() {
  const { pathname } = useLocation()
  // Hide the tab bar while logging a workout or editing a template, to give the sets room.
  if (pathname.startsWith('/workout/') || pathname.startsWith('/templates/')) return null
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

export default function App() {
  const keepAwake = useKeepAwakeSetting()
  const training = useLiveQuery(async () => (await getActiveWorkout()) !== undefined, [])
  useScreenWakeLock(keepAwake && training === true)

  return (
    <HashRouter>
      <main className="app">
        <Routes>
          <Route path="/" element={<StartPage />} />
          <Route path="/workout/:id" element={<WorkoutPage />} />
          <Route path="/templates/:id" element={<TemplateEditor />} />
          <Route path="/history" element={<HistoryPage />} />
          <Route path="/exercises" element={<ExercisesPage />} />
          <Route path="/exercises/:id" element={<ExerciseDetailPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="*" element={<StartPage />} />
        </Routes>
      </main>
      <RestTimerBar />
      <TabBar />
    </HashRouter>
  )
}
