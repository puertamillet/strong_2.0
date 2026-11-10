# Strong 2.0

App de entrenamiento de fuerza para iPhone, gratuita y sin suscripción. Es una web app instalable (PWA): se abre desde Safari, se añade a la pantalla de inicio y funciona sin conexión. Los datos se guardan en el propio dispositivo (IndexedDB).

## Funciones

- Entreno activo: series con peso y repeticiones, columna «Anterior» con lo que hiciste la última vez, tipos de serie (calentamiento, top set, back off, drop set, al fallo) y descanso propio en cada serie, elegido con una rueda de minutos y segundos de 10 en 10. Bajo cada serie, una línea a todo lo ancho con su descanso; al marcar la serie se convierte en una barra que se va vaciando. Abajo, el temporizador con −10 y +10 s, y un ping al terminar (con la app en pantalla; en Ajustes se puede probar y hacer que suene aunque el iPhone esté en silencio, lo que pausa la música o el podcast).
- Ejercicios unilaterales: como en Strong, una serie por lado (el doble de series de las que son). El ejercicio guarda su lateralidad para contar las series reales por músculo.
- Notas fijas en amarillo, siempre visibles con el ejercicio, y rangos de repeticiones por serie en las plantillas.
- La pantalla no se apaga sola durante el entreno (opción en Ajustes, activada por defecto).
- Aviso al acabar el descanso con el iPhone bloqueado o en otra app: una notificación que suena y vibra (en silencio, solo vibra) y dice cuál es la siguiente serie. Necesita un pequeño servidor gratuito en Cloudflare; ver [Avisos con el iPhone bloqueado](#avisos-con-el-iphone-bloqueado).
- Plantillas de rutina: crear, editar y empezar un entreno desde una plantilla. Al terminar, si algo cambió, pregunta como Strong: actualizar solo los valores, actualizar plantilla y valores (dice qué cambia, en rojo si quita ejercicios o series) o mantener la plantilla original. Se importan y exportan en CSV (una fila por serie) desde Ajustes.
- Catálogo de ejercicios con buscador y grupos musculares.
- Historial de entrenos (editable).
- Importación del CSV que exporta Strong (Ajustes → Exportar datos): entrenos, ejercicios, notas, tipos de serie y descansos, sin duplicar si se importa otra vez.
- Copia de seguridad completa en JSON (guardar y restaurar) y exportación a CSV con el formato de Strong.

- Progreso por ejercicio: gráficas de 1RM estimado, peso máximo, volumen y repeticiones (3 meses, 1 año o todo), récords personales y mejor peso por repeticiones, e historial de sesiones.
- Récords marcados con un trofeo al registrar una serie y en el historial; resumen de entrenos por semana.

## Publicación

Cada push a `main` publica la app en GitHub Pages (`.github/workflows/deploy.yml`): https://puertamillet.github.io/strong_2.0/

La app instalada busca una versión nueva al abrirse, al volver a ella y cada hora, y se recarga sola cuando la encuentra. Al final de Ajustes aparece la versión instalada (commit y fecha de compilación).

## Avisos con el iPhone bloqueado

iOS congela las apps web en segundo plano, así que con el iPhone bloqueado la app no puede sonar por sí misma. Lo que sí puede es recibir una notificación push: al empezar un descanso, la app le dice a un pequeño servidor cuándo acaba, y en ese momento el servidor pide a Apple que avise al iPhone. El servidor (`push-server/`) es un Worker de Cloudflare que cabe de sobra en el plan gratuito. Solo guarda la dirección push del iPhone (una URL opaca de Apple) y la hora a la que acaba el descanso; el texto de la notificación («Siguiente: …») se hace en el propio iPhone.

Para activarlo (unos 5 minutos, una sola vez):

1. Crea una cuenta gratuita en [Cloudflare](https://dash.cloudflare.com/sign-up) (no pide tarjeta).
2. En el panel, entra una vez en **Workers y Pages**: así la cuenta tiene su subdominio `*.workers.dev` (si te pide elegirlo, pon el que quieras).
3. Crea un token en [Perfil → Tokens de API](https://dash.cloudflare.com/profile/api-tokens) → **Crear token** → plantilla **Editar Cloudflare Workers** (*Edit Cloudflare Workers*). En *Recursos de la cuenta* elige tu cuenta y en *Recursos de zona*, todas las zonas. Copia el token (solo se muestra una vez).
4. Copia el **ID de cuenta** (*Account ID*): son los 32 caracteres que van justo después de `dash.cloudflare.com/` en la dirección del panel. También aparece en la página de Workers y Pages.
5. En GitHub, en [Settings → Secrets and variables → Actions](https://github.com/puertamillet/strong_2.0/settings/secrets/actions), crea dos secretos con **New repository secret**: `CLOUDFLARE_API_TOKEN` (el token) y `CLOUDFLARE_ACCOUNT_ID` (el ID de cuenta).
6. Vuelve a publicar: en [Actions → Deploy](https://github.com/puertamillet/strong_2.0/actions/workflows/deploy.yml) → **Run workflow** (o al fusionar cualquier PR). En el registro del paso «push-server» aparece la dirección del servidor, `https://strong2-avisos.<subdominio>.workers.dev`.
7. En el iPhone (iOS 16.4 o posterior), abre la app desde la pantalla de inicio cuando se haya actualizado, ve a **Ajustes → Avisar con el iPhone bloqueado** y permite las notificaciones. Pulsa **Probar el aviso** y bloquea el iPhone: en 10 segundos llega la notificación.

Bueno saber:

- La notificación suena con el tono de notificaciones de iOS (una web app no puede elegir otro) y llega uno o dos segundos después de que acabe el descanso. Si la app está en pantalla, suena el ping y además llega la notificación, que es la que hace vibrar.
- Se ajusta en el iPhone en Ajustes → Notificaciones → Strong 2.0. Si usas un modo de concentración en el gimnasio, permite en él las notificaciones de la app.
- Si dejan de llegar, desactiva y vuelve a activar el aviso en Ajustes de la app.
- Sin los secretos de Cloudflare la app se publica igual, sin esta opción.

## Desarrollo

```bash
npm install
npm run dev      # servidor local
npm test         # tests (Vitest)
STRONG_CSV=/ruta/a/strong.csv npm test   # además valida un export real de Strong
npm run lint     # oxlint
npm run build    # compila a dist/
```

Servidor de avisos en local. Los avisos necesitan el service worker, que solo tiene la versión compilada:

```bash
cd push-server && npm install
npx wrangler dev --var ALLOWED_ORIGINS:http://localhost:4173            # http://127.0.0.1:8787
# en la raíz, en otra terminal:
VITE_PUSH_URL=http://127.0.0.1:8787 npm run build && npm run preview    # http://localhost:4173
```

Stack: React + TypeScript + Vite, Dexie (IndexedDB), React Router (HashRouter) y vite-plugin-pwa.

### Estructura

- `src/db.ts`: modelo de datos y esquema de la base de datos.
- `src/lib/`: lógica sin interfaz (entrenos, formato, temporizador, estadísticas, CSV de Strong, copias de seguridad).
- `src/pages/`: pantallas (Entrenar, Entreno, Plantilla, Historial, Ejercicios, Detalle de ejercicio, Ajustes).
- `src/components/`: piezas reutilizables (selector de ejercicios, temporizador, inputs, gráficas SVG, iconos).
- `public/push-sw.js`: la parte del service worker que muestra la notificación al acabar el descanso.
- `push-server/`: el servidor de avisos (Cloudflare Worker con un Durable Object que guarda los descansos y su alarma, y firma VAPID de los push).

## Instalar en el iPhone

Abre la URL de la app en Safari → botón Compartir → «Añadir a pantalla de inicio». Instalada así, iOS no borra los datos por inactividad.
