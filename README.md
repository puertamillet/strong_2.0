# Strong 2.0

App de entrenamiento de fuerza para iPhone, gratuita y sin suscripción. Es una web app instalable (PWA): se abre desde Safari, se añade a la pantalla de inicio y funciona sin conexión. Los datos se guardan en el propio dispositivo (IndexedDB).

## Funciones

- Entreno activo: series con peso y repeticiones, columna «Anterior» con lo que hiciste la última vez, tipos de serie (calentamiento, drop set, al fallo) y temporizador de descanso por ejercicio.
- Plantillas de rutina: crear, editar, empezar un entreno desde una plantilla y actualizarla al terminar.
- Catálogo de ejercicios con buscador y grupos musculares.
- Historial de entrenos (editable).
- Importación del CSV que exporta Strong (Ajustes → Exportar datos): entrenos, ejercicios, notas, tipos de serie y descansos, sin duplicar si se importa otra vez. Opcionalmente crea plantillas con las rutinas de los últimos 3 meses.
- Copia de seguridad completa en JSON (guardar y restaurar) y exportación a CSV con el formato de Strong.

- Progreso por ejercicio: gráficas de 1RM estimado, peso máximo, volumen y repeticiones (3 meses, 1 año o todo), récords personales y mejor peso por repeticiones, e historial de sesiones.
- Récords marcados con un trofeo al registrar una serie y en el historial; resumen de entrenos por semana.

## Publicación

Cada push a `main` publica la app en GitHub Pages (`.github/workflows/deploy.yml`): https://puertamillet.github.io/strong_2.0/

## Desarrollo

```bash
npm install
npm run dev      # servidor local
npm test         # tests (Vitest)
STRONG_CSV=/ruta/a/strong.csv npm test   # además valida un export real de Strong
npm run lint     # oxlint
npm run build    # compila a dist/
```

Stack: React + TypeScript + Vite, Dexie (IndexedDB), React Router (HashRouter) y vite-plugin-pwa.

### Estructura

- `src/db.ts`: modelo de datos y esquema de la base de datos.
- `src/lib/`: lógica sin interfaz (entrenos, formato, temporizador, estadísticas, CSV de Strong, copias de seguridad).
- `src/pages/`: pantallas (Entrenar, Entreno, Plantilla, Historial, Ejercicios, Detalle de ejercicio, Ajustes).
- `src/components/`: piezas reutilizables (selector de ejercicios, temporizador, inputs, gráficas SVG, iconos).

## Instalar en el iPhone

Abre la URL de la app en Safari → botón Compartir → «Añadir a pantalla de inicio». Instalada así, iOS no borra los datos por inactividad.
