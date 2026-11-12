/*
 * Notifications, added to the service worker that vite-plugin-pwa generates (see vite.config.ts
 * and src/lib/push.ts). The push server sends an empty message when a rest is over; the text is
 * made here, on the phone, from the workout in progress. The weekly reminder to choose what to
 * film comes with a message, { type: 'grabar' }, and a tap on it opens that page.
 */

const numberFormat = new Intl.NumberFormat('es-ES', { maximumFractionDigits: 2, useGrouping: false })

/** The exercise's name as the app writes it (exerciseLabel in src/lib/exercises.ts): "Press de banca (barra)". */
function exerciseLabel(exercise) {
  const equipment = exercise.equipment
  return equipment && equipment !== 'Peso corporal' ? `${exercise.name} (${equipment.toLowerCase()})` : exercise.name
}

/** "Press de banca (barra) · 60 kg × 8", the first set not ticked yet of the workout in progress. */
async function nextSetText() {
  const db = await new Promise((resolve, reject) => {
    const req = indexedDB.open('strong2')
    // The app has never opened its database: don't make an empty one.
    req.onupgradeneeded = () => req.transaction.abort()
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
  try {
    if (!db.objectStoreNames.contains('workouts') || !db.objectStoreNames.contains('exercises')) return null
    const tx = db.transaction(['workouts', 'exercises'])
    // The workout in progress is always the last one started.
    const workout = await new Promise((resolve, reject) => {
      const req = tx.objectStore('workouts').index('startedAt').openCursor(null, 'prev')
      req.onsuccess = () => resolve(req.result ? req.result.value : null)
      req.onerror = () => reject(req.error)
    })
    if (!workout || workout.endedAt !== null) return null
    for (const we of workout.exercises) {
      const set = we.sets.find((s) => !s.done)
      if (!set) continue
      const exercise = await new Promise((resolve) => {
        const req = tx.objectStore('exercises').get(we.exerciseId)
        req.onsuccess = () => resolve(req.result)
        req.onerror = () => resolve(null)
      })
      const name = exercise ? exerciseLabel(exercise) : 'Siguiente ejercicio'
      if (set.reps === null && set.weight === null) return name
      const values = set.weight ? `${numberFormat.format(set.weight)} kg × ${set.reps ?? '—'}` : `${set.reps} reps`
      return `${name} · ${values}`
    }
    return null
  } finally {
    db.close()
  }
}

/** The message that came with a push: null for the end of a rest, which comes without one. */
function messageOf(event) {
  try {
    return event.data ? event.data.json() : null
  } catch {
    return null
  }
}

async function showRestOver() {
  let next = null
  try {
    next = await nextSetText()
  } catch {
    // Show the notification anyway.
  }
  await self.registration.showNotification('Descanso terminado', {
    body: next ? `Siguiente: ${next}` : 'A por la siguiente serie',
    tag: 'descanso',
    renotify: true,
    icon: 'pwa-192x192.png',
    badge: 'favicon-32.png',
  })
}

/** The weekly reminder: a tap opens the page to choose the exercises (#/filming). */
async function showFilmingReminder() {
  await self.registration.showNotification('Grabar esta semana', {
    body: 'Elige los ejercicios que te toca grabar: en el entreno verás marcada la serie.',
    tag: 'grabar',
    icon: 'pwa-192x192.png',
    badge: 'favicon-32.png',
    data: { hash: '#/filming' },
  })
}

self.addEventListener('push', (event) => {
  const message = messageOf(event)
  // iOS requires a notification for every push: always show one.
  event.waitUntil(message && message.type === 'grabar' ? showFilmingReminder() : showRestOver())
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const hash = (event.notification.data && event.notification.data.hash) || ''
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      for (const client of windows) {
        if ('focus' in client) {
          // The app is open: it goes there itself (followNotificationClicks in src/lib/push.ts).
          if (hash) client.postMessage({ type: 'open', hash })
          return client.focus()
        }
      }
      return self.clients.openWindow(`./${hash}`)
    })(),
  )
})
