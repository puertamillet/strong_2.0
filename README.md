# Strong 2.0

App de entrenamiento de fuerza para iPhone, gratuita y sin suscripción. Es una web app instalable (PWA): se abre desde Safari, se añade a la pantalla de inicio y funciona sin conexión. Los datos se guardan en el propio dispositivo (IndexedDB). También está como app de iPhone, con avisos nativos: ver [App para iPhone](#app-para-iphone).

## Funciones

- Panel, la primera pestaña: esta semana (entrenos, series, tonelaje y tiempo) frente a la media de las anteriores, cada cifra semana a semana en las últimas 12 semanas, y las series semanales de cada músculo en la figura del cuerpo (en cuatro tonos) y en barras, con las 12 semanas de cada músculo al tocarlo. Cuentan las series reales: sin calentamientos y, en los unilaterales, cada par de lados es una serie.
- Entreno activo: series con peso y repeticiones, columna «Anterior» con lo que hiciste la última vez, tipos de serie (calentamiento, top set, back off, drop set, al fallo) y descanso propio en cada serie, elegido con una rueda de minutos y segundos de 10 en 10. Bajo cada serie, una línea a todo lo ancho con su descanso; al marcar la serie se convierte en una barra que se va vaciando. Abajo, el temporizador con −10 y +10 s y «Saltar», y un ping al terminar o saltarlo (con la app en pantalla): un doble «ding» metálico, sintetizado en `src/lib/ping.ts`. El ping suena por encima de la música o el podcast y nunca los para; por eso, con el iPhone en silencio no suena (iOS solo deja sonar en silencio pausando lo que escuchas, y luego no lo reanuda) y avisa la vibración de la notificación (en la [app para iPhone](#app-para-iphone) sí suena en silencio, y también con el iPhone bloqueado). En Ajustes se puede probar.
- Durante el entreno se puede cambiar todo lo de la plantilla, como en Strong: deslizar a la izquierda una serie, el descanso de debajo o una nota para borrarlos (un poco y queda el botón «Borrar»; del todo y se borra), añadir series, cambiar su tipo (menú del número de serie) o su rango de repeticiones (tocándolo), sus descansos, las notas y el orden de los ejercicios. Al terminar se ofrece pasar los cambios a la plantilla.
- Aviso de estancado: si un ejercicio lleva 4 entrenos sin que ninguna serie supere a la misma serie de los 4 entrenos anteriores (con más peso, aunque sea con menos repeticiones, o con más repeticiones), durante el entreno lo dice bajo su nombre, hasta que una serie lo mejora.
- Respuesta háptica al marcar, añadir y borrar series: en iPhone con iOS 18 o posterior (una web app no puede hacer vibrar el iPhone de otra forma) y en Android.
- Ejercicios unilaterales: como en Strong, una serie por lado (el doble de series de las que son). La lateralidad es una clasificación del ejercicio, no parte de su nombre, y sirve para contar las series reales por músculo.
- Una nota por ejercicio, en amarillo: se ve siempre con el ejercicio, vuelve a salir la próxima vez y pasa a la plantilla (es la nota fija de Strong). Y rangos de repeticiones por serie.
- La pantalla no se apaga sola durante el entreno (opción en Ajustes, activada por defecto).
- Aviso al acabar el descanso con el iPhone bloqueado o en otra app: una notificación que suena y vibra (en silencio, solo vibra) y dice cuál es la siguiente serie. Las notificaciones no se acumulan: cada una sustituye a la anterior y se quitan al volver a la app. Necesita un pequeño servidor gratuito en Cloudflare; ver [Avisos con el iPhone bloqueado](#avisos-con-el-iphone-bloqueado).
- Grabarte: los lunes a las 15:00 (la hora se cambia en Ajustes) llega un aviso para elegir los ejercicios que te toca grabar esa semana; al tocarlo se abre «Grabar esta semana», que también está en Entrenar, con los ejercicios de cada plantilla. En el entreno, la primera serie (que no sea de calentamiento) de cada ejercicio elegido lleva la marca «Grábate esta serie»; en la plantilla se puede elegir otra serie desde el menú de la serie («Grabar esta serie»), y el CSV de plantillas lo guarda en la columna «Grabar». Usa el mismo servidor que el aviso del descanso, y los dos avisos se activan por separado.
- Plantillas de rutina: crear, editar y empezar un entreno desde una plantilla. Al terminar, si algo cambió, pregunta como Strong: actualizar solo los valores, actualizar plantilla y valores (dice qué cambia, en rojo si quita ejercicios o series) o mantener la plantilla original. En Entrenar, cada plantilla dice cuándo se hizo por última vez y cuánto duran de media sus 4 últimas sesiones (sin contar las de menos de 10 minutos ni las de más de 4 horas, empezadas por error u olvidadas abiertas). Se importan y exportan en CSV (una fila por serie) desde Ajustes. Para cambiar su orden en Entrenar, mantener pulsada una plantilla hasta que se levante y arrastrarla; el CSV sale en ese mismo orden.
- Catálogo de ejercicios en español (`src/data/ejercicios.csv`): cada uno con su material, lateralidad (bilateral o unilateral), músculos principales y secundarios, y sus nombres en Strong para que las importaciones lo encuentren. El material y la lateralidad se ven en recuadros junto al nombre.
- Buscador con filtros por material, zona del cuerpo y músculo; las listas y los filtros solo tienen en cuenta los músculos principales. Al crear o editar un ejercicio hay que indicar todos los datos (las notas son opcionales).
- Ficha de cada ejercicio con una figura del cuerpo, de frente y de espaldas, con los músculos principales y los secundarios en otro tono. La figura (aquí y en el Panel) es de hombre o de mujer según Ajustes.
- Historial de entrenos (editable).
- Importación del CSV que exporta Strong (Ajustes → Exportar datos): entrenos, ejercicios, notas, tipos de serie y descansos, sin duplicar si se importa otra vez.
- Ajustes oculta por ahora los apartados de lo que se configura una vez (Entreno, Grabarte, Importar desde Strong y Plantillas), que ya están como se quieren. Vuelven a verse con `SHOW_SET_ONCE = true` en `src/lib/setOnce.ts`; lo configurado sigue funcionando mientras tanto.
- Copia de seguridad completa en JSON (guardar y restaurar) y exportación a CSV con el formato de Strong.

- Progreso por ejercicio: gráficas de 1RM estimado, peso máximo, tonelaje (peso × repeticiones) y repeticiones (3 meses, 1 año o todo), récords personales y mejor peso por repeticiones, e historial de sesiones.
- Récords marcados con un trofeo al registrar una serie y en el historial.

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

- La notificación suena con el tono de notificaciones de iOS (una web app no puede elegir otro) y llega uno o dos segundos después de que acabe el descanso. Si la app está en pantalla, suena el ping y además llega la notificación, que es la que hace vibrar (una web app no puede hacer vibrar el iPhone por sí misma) y que se quita sola a los pocos segundos.
- iOS añade «from Strong 2.0» (el nombre de la app) a todas las notificaciones de las apps web; la app solo elige el título y el texto.
- Si no vibra: en el iPhone, Ajustes → Notificaciones → Strong 2.0 con los sonidos activados, y Ajustes → Sonidos y vibraciones con la vibración activada (también en modo silencio, si lo quieres así).
- Se ajusta en el iPhone en Ajustes → Notificaciones → Strong 2.0. Si usas un modo de concentración en el gimnasio, permite en él las notificaciones de la app.
- Si dejan de llegar, desactiva y vuelve a activar el aviso en Ajustes de la app.
- El aviso de los lunes para grabarte va por el mismo servidor: actívalo en **Ajustes → Grabarte** y pulsa **Probar el aviso de los lunes** para recibirlo en 10 segundos. Sigue la hora de España también cuando cambia la hora en verano e invierno (el servidor guarda la zona horaria del iPhone).
- Sin los secretos de Cloudflare la app se publica igual, sin esta opción.

## Desarrollo

```bash
npm install
npm run dev      # servidor local
npm test         # tests (Vitest)
STRONG_CSV=/ruta/a/strong.csv npm test   # además valida un export real de Strong
npm run lint     # oxlint
npm run build    # compila a dist/
npx cap sync ios # copia dist/ a la app para iPhone (compilarla necesita un Mac con Xcode; lo hace GitHub)
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
- `src/components/`: piezas reutilizables (selector de ejercicios, temporizador, inputs, gráficas SVG, figura del cuerpo, iconos).
- `src/data/`: el catálogo de ejercicios y los dibujos de la figura del cuerpo.
- `public/push-sw.js`: la parte del service worker que muestra las notificaciones (fin del descanso y aviso de los lunes) y abre la página al tocar la del lunes.
- `capacitor.config.ts`, `ios/`: la app para iPhone (Capacitor), con `src/lib/native.ts` y `src/lib/localNotifications.ts` para lo nativo.
- `native/strong-native/`: el plugin propio de la app para iPhone (el ping, también con el iPhone bloqueado, el descanso en la pantalla de bloqueo y mantener la pantalla encendida, en Swift). La actividad en directo la dibuja la extensión `ios/App/RestActivity`.
- `push-server/`: el servidor de avisos (Cloudflare Worker con un Durable Object que guarda los descansos, los avisos semanales y su alarma, firma VAPID de los push y cifra el mensaje del aviso semanal, RFC 8291).

## Créditos

Los dibujos de la figura del cuerpo (`src/data/bodyFigure.ts`) vienen de [react-native-body-highlighter](https://www.npmjs.com/package/react-native-body-highlighter) 3.2.0, © 2022 ELABBASSI Hicham, con licencia MIT (incluida en ese archivo), agrupados por los músculos de la app.

## Instalar en el iPhone

Abre la URL de la app en Safari → botón Compartir → «Añadir a pantalla de inicio». Instalada así, iOS no borra los datos por inactividad.

## App para iPhone

La misma app dentro de una app nativa de iPhone (Capacitor, carpeta `ios/`), para lo que una app web no puede hacer:

- Los avisos al acabar el descanso y el de los lunes son notificaciones locales del propio iPhone: sin servidor, sin «from Strong 2.0», con el ping de la app como sonido, y se quitan solas al volver a la app.
- El ping suena también con el iPhone en silencio, bloqueado o en otra app, y la música o el podcast solo bajan un momento de volumen, sin pararse. También suena al saltar el descanso. Durante el descanso la app reproduce silencio, mezclado con lo que escuches, para que iOS no la congele; al acabar suena el ping, vibra y la pantalla de bloqueo dice «Descanso terminado» (ver abajo), así que no llega notificación (sí llega, sin sonido, si las actividades en directo están desactivadas). Si iOS cierra la app, suena la notificación, con el mismo ping (en silencio solo vibra).
- Durante el descanso, la cuenta atrás, una barra que se vacía y la siguiente serie se ven en la pantalla de bloqueo y en la Dynamic Island (una actividad en directo, iOS 16.2 o posterior, en `ios/App/RestActivity`). Al acabar dice «Descanso terminado» con la siguiente serie, hasta el próximo descanso o el final del entreno. Sin cuenta de desarrollador de pago no hay push, así que la cambia la propia app.
- Vibra al acabar el descanso y al marcar series.
- Las copias de seguridad y los CSV se guardan con el menú de compartir («Guardar en Archivos»).

GitHub la compila en sus Mac con cada cambio (`.github/workflows/ios.yml`): la prueba en el simulador y, en `main`, publica el `.ipa` sin firmar en la versión [«ios»](../../releases/tag/ios) del repositorio. Se instala con [SideStore](https://sidestore.io), que la firma con tu Apple ID, gratis:

1. Instala SideStore siguiendo [su guía](https://docs.sidestore.io/docs/installation/prerequisites): en Windows, iTunes e iloader en el ordenador y LocalDevVPN en el iPhone.
2. En SideStore, añade la fuente `https://github.com/puertamillet/strong_2.0/releases/download/ios/fuente-sidestore.json` e instala Strong 2.0 desde ella: así SideStore avisa de cada versión nueva. También vale descargar `Strong2.ipa` en el iPhone y abrirlo con SideStore.
3. Pasa los datos: en la app web, **Ajustes → Guardar copia completa (JSON)** y «Guardar en Archivos»; en la app para iPhone, **Ajustes → Restaurar una copia…**. Cada app guarda sus propios datos.
4. La primera vez que se abre pide permiso para las notificaciones. El aviso de los lunes se activa otra vez en **Ajustes → Grabarte** (desactívalo en la app web para no recibirlo dos veces).

Con un Apple ID gratuito la app caduca a los 7 días: SideStore la renueva desde el iPhone, con wifi y LocalDevVPN conectado. Si llega a caducar no se pierden los datos, basta con renovarla. Si se borra la app, sí: haz copias de seguridad.
