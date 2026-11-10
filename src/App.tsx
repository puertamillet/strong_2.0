import { HashRouter, NavLink, Route, Routes, useLocation } from 'react-router-dom'
import { RestTimerBar } from './components/RestTimerBar'
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
        <span aria-hidden>🏋️</span>
        Entrenar
      </NavLink>
      <NavLink to="/history">
        <span aria-hidden>🕑</span>
        Historial
      </NavLink>
      <NavLink to="/exercises">
        <span aria-hidden>📋</span>
        Ejercicios
      </NavLink>
      <NavLink to="/settings">
        <span aria-hidden>⚙️</span>
        Ajustes
      </NavLink>
    </nav>
  )
}

export default function App() {
  return (
    <HashRouter>
      <main className="app">
        <Routes>
          <Route path="/" element={<StartPage />} />
          <Route path="/workout/:id" element={<WorkoutPage />} />
          <Route path="/templates/:id" element={<TemplateEditor />} />
          <Route path="/history" element={<HistoryPage />} />
          <Route path="/exercises" element={<ExercisesPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="*" element={<StartPage />} />
        </Routes>
      </main>
      <RestTimerBar />
      <TabBar />
    </HashRouter>
  )
}
