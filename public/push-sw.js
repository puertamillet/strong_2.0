/*
 * Rest notifications, added to the service worker that vite-plugin-pwa generates (see
 * vite.config.ts and src/lib/push.ts). The push server sends an empty message when a rest is
 * over; the text is made here, on the phone, from the workout in progress.
 */

const numberFormat = new Intl.NumberFormat('es-ES', { maximumFractionDigits: 2, useGrouping: false })

/** "Press de banca · 60 kg × 8", the first set not ticked yet of the workout in progress. */
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
      const name = exercise ? exercise.name : 'Siguiente ejercicio'
      if (set.reps === null && set.weight === null) return name
      const values = set.weight ? `${numberFormat.format(set.weight)} kg × ${set.reps ?? '—'}` : `${set.reps} reps`
      return `${name} · ${values}`
    }
    return null
  } finally {
    db.close()
  }
}

self.addEventListener('push', (event) => {
  event.waitUntil(
    (async () => {
      let next = null
      try {
        next = await nextSetText()
      } catch {
        // Show the notification anyway.
      }
      // iOS requires a notification for every push: always show one.
      await self.registration.showNotification('Descanso terminado', {
        body: next ? `Siguiente: ${next}` : 'A por la siguiente serie',
        tag: 'descanso',
        renotify: true,
        icon: 'pwa-192x192.png',
        badge: 'favicon-32.png',
      })
    })(),
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      for (const client of windows) {
        if ('focus' in client) return client.focus()
      }
      return self.clients.openWindow('./')
    })(),
  )
})
