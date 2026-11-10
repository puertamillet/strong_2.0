# Strong 2.0

App de entrenamiento de fuerza para iPhone, gratuita y sin suscripción. Es una web app instalable (PWA): se abre desde Safari, se añade a la pantalla de inicio y funciona sin conexión. Los datos se guardan en el propio dispositivo (IndexedDB).

## Funciones

- Entreno activo: series con peso y repeticiones, columna «Anterior» con lo que hiciste la última vez, tipos de serie (calentamiento, drop set, al fallo) y temporizador de descanso por ejercicio.
- Plantillas de rutina: crear, editar, empezar un entreno desde una plantilla y actualizarla al terminar.
- Catálogo de ejercicios con buscador y grupos musculares.
- Historial de entrenos (editable).

Próximos pasos: importar el historial exportado de Strong (CSV), gráficas de progreso y récords.

## Publicación

Cada push a `main` publica la app en GitHub Pages (`.github/workflows/deploy.yml`): https://puertamillet.github.io/strong_2.0/

## Desarrollo

```bash
npm install
npm run dev      # servidor local
npm test         # tests (Vitest)
npm run lint     # oxlint
npm run build    # compila a dist/
```

Stack: React + TypeScript + Vite, Dexie (IndexedDB), React Router (HashRouter) y vite-plugin-pwa.

### Estructura

- `src/db.ts`: modelo de datos y esquema de la base de datos.
- `src/lib/`: lógica sin interfaz (entrenos, formato, temporizador, estadísticas).
- `src/pages/`: pantallas (Entrenar, Entreno, Plantilla, Historial, Ejercicios).
- `src/components/`: piezas reutilizables (selector de ejercicios, temporizador, inputs).

## Instalar en el iPhone

Abre la URL de la app en Safari → botón Compartir → «Añadir a pantalla de inicio». Instalada así, iOS no borra los datos por inactividad.
