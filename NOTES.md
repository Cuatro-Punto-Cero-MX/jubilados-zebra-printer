# Estado del proyecto — Motor de impresión dúplex Zebra ZC300

> Ver plan completo en `/Users/isaac/.claude/plans/te-acabo-de-conectar-lovely-walrus.md`

## Al día — 2026-09-03

**✅ Primer print en hardware Windows real (Zebra ZC300).** Con el fix v0.1.1
abajo, el agente arranca bien en Windows, aparece en la bandeja y `/health`
responde `platform: win32`. Se imprimió una credencial de punta a punta desde la
app Rails. (Detalle de operación: hay que elegir la impresora correcta desde el
menú de la bandeja — la primera vez se había elegido otra y no imprimía.)

**Auto-update por GitHub Releases (v0.1.2).** `build.publish` cambió de un
placeholder `generic` a `provider: github` (owner `Cuatro-Punto-Cero-MX`, repo
`jubilados-zebra-printer`). El repo es público, así que `electron-updater` revisa
las Releases sin token. Con esto, `git push --tags` → workflow publica la Release
→ los agentes instalados se actualizan al reiniciar. También quita el
`net::ERR_NAME_NOT_RESOLVED` que salía en `agent.log` al intentar contactar el
placeholder.

**Log más liviano (v0.1.2).** `server.js` ya no vuelca el base64 completo de las
imágenes en `agent.log` — registra `<data:image/png;base64, N chars>` en su lugar
(`describeSource`).

**Repo en GitHub + build por CI.** El agente ahora vive en
`github.com/Cuatro-Punto-Cero-MX/jubilados-zebra-printer` (público). El `.exe` se
compila en GitHub Actions (`.github/workflows/build-windows.yml`, runner
`windows-latest`) porque electron-builder no cruza-compila confiable desde macOS
ARM. Sacar versión: subir `version` en `package.json`, `git tag vX.Y.Z && git push
--tags` → publica un Release con el instalador. Ver README.

**v0.1.0 fallaba en silencio en Windows** (primer intento en hardware real): el
`.exe` se instalaba pero al abrirlo no aparecía nada — ni bandeja ni ventana ni
error. Dos bugs de empaquetado:

1. `build/` (donde está el ícono de bandeja) no estaba en `build.files` de
   `package.json`, así que `build/icon.png` no se incluía en el `app.asar`. En
   Windows `new Tray()` con una imagen vacía **lanza excepción**, y como pasa
   dentro del `.then()` de `app.whenReady()` sin handler, la app queda como
   proceso zombie invisible (el `window-all-closed` preventDefault evita que
   cierre). En Mac no había reventado porque casi siempre se corrió con `npm
   start` (sin empaquetar), donde el ícono sí está en disco.
2. `pdf-to-printer` trae `dist/SumatraPDF-3.4.6-32.exe` empaquetado y lo resuelve
   con `path.join(__dirname, ...)`. Dentro del `app.asar` no se puede ejecutar un
   binario — habría reventado al primer print aunque el arranque funcionara.

Fix (v0.1.1): agregado `build/**/*` a `files`, `asarUnpack` de
`node_modules/pdf-to-printer/**`, y handlers de `uncaughtException` /
`unhandledRejection` + guard alrededor de `new Tray()` en `main.js` para que un
ícono faltante ya no mate el arranque y quede en el log.

## Al día — 2026-08-21

**Conectado con el backend Rails (`sistema-web-para-credencializacion`).** El botón "Imprimir credencial" en `personas#show` dispara el flujo desde JS del navegador (no desde Rails backend — en producción Rails vive en un servidor remoto que no puede alcanzar el `127.0.0.1:8942` de la máquina de recepción). El navegador descarga las imágenes ya autenticado (misma sesión de Devise), las convierte a `data:` URI, y llama `POST /print` directo. Se agregó soporte CORS en `src/server.js` para que el `fetch()` cross-origin desde el origen de Rails no sea bloqueado por el navegador.

**Electron actualizado de `^32.2.6` a `^43.4.1`** (la ^32 ya había salido de la ventana de soporte de Electron — solo se mantienen las últimas 3 mayores). Pendiente re-validar físicamente en la ZC300 que el `pageSize` en pulgadas y el fix de `loadFile` para imágenes locales (ver "Bugs encontrados" abajo) se siguen comportando igual con el Chromium más nuevo — se descubrieron empíricamente en la 32 y podrían cambiar.

**Impresión en Windows implementada** (`printPdfWindows` en `src/printEngine.js`, antes un stub) usando `pdf-to-printer` (trae SumatraPDF empaquetado, imprime silenciosamente con `side: 'duplex'`). **Sin probar en hardware real todavía** — falta una máquina Windows con la Zebra conectada. Importante: SumatraPDF puede activar el dúplex estándar de Windows, pero no tiene forma de mandar `RibbonCombination` (extensión propia del PPD de Zebra, sin equivalente en la API de impresión de Windows) — ahí va a haber que configurar la combinación de cinta una sola vez desde las Preferencias de impresión del driver, no por job como en Mac.

**Bug de empaquetado encontrado y corregido**: el `"files"` del bloque `"build"` en `package.json` (`["main.js", "src/**/*"]`) nunca incluía `node_modules` — es decir, ni siquiera `express`/`electron-updater` se estaban empaquetando en el instalador final. Se agregó `"node_modules/**/*"` a `files` (electron-builder filtra automáticamente devDependencies al resolver ese patrón).

## Al día — 2026-08-15

**Impresión dúplex funcionando de punta a punta en Mac.** Se resolvió lo de la cinta (con tape, siguiendo un tutorial de YouTube), se instaló el driver Zebra, se confirmó que el ZC300 es dual-sided, y ya se construyó y probó físicamente el agente Electron completo: `POST /print` con imágenes de frente/reverso → PDF de tarjeta → CUPS con `DualSidePrinting=true` → tarjeta impresa por ambos lados sin voltear manualmente.

## Cómo correr la app en desarrollo

```
cd /Users/isaac/code/zebra_zc300
npm install   # ya corrido una vez
npm start
```

La app corre en la bandeja del sistema (sin ícono de dock) y expone una API local:
- `GET  http://127.0.0.1:8942/health` — estado + impresora configurada
- `GET  http://127.0.0.1:8942/printers` — impresoras del sistema
- `POST http://127.0.0.1:8942/preview` — igual que `/print` pero regresa el PDF sin imprimir (para calibrar sin gastar tarjetas)
- `POST http://127.0.0.1:8942/print` — imprime. Body: `{ "frontImage": "<path>", "backImage": "<path>" }` (o `{ "pdfPath": "<path a PDF de 2 páginas>" }`)

Config y logs en `~/Library/Application Support/credencial-print-agent/` (`config.json`, `agent.log`). El nombre de impresora se elige desde el menú de la bandeja del sistema (ícono junto al reloj).

## Bugs encontrados y corregidos durante la implementación

1. **`webContents.print({ duplexMode })` no aplica** — el driver Zebra expone el dúplex como opción propia del PPD de CUPS (`DualSidePrinting=true` + `RibbonCombination`), no como el `sides` estándar. El motor manda el PDF directo por `lp -o DualSidePrinting=true` en vez de usar la API de impresión de Electron.
2. **Imágenes `file://` no cargaban desde un documento `data:`** — Chromium bloquea cargar recursos `file://` locales desde un documento `data:` (distinto origen). Fix: escribir el HTML a un archivo temporal real y usar `win.loadFile()`.
3. **`printToPDF({ pageSize: {...} })` en micrones producía PDFs completamente en blanco** — a pesar de que la documentación clásica de Electron dice que el `pageSize` custom va en micrones, en la versión instalada (Electron ^32) el valor correcto son **pulgadas**. Se confirmó empíricamente comparando `capturePage()` (que sí mostraba contenido) contra `printToPDF` con distintas unidades. `src/printEngine.js` ya usa pulgadas (`CARD_PAGE_SIZE`).
4. **Combinación de cinta por default** (`RibbonCombination = FrontYmcoBackK`) imprime el reverso siempre en negro/monocromo sin importar el color de la imagen fuente — el frente sale a color completo. Es esperado, no un bug — hay que diseñarlo así o cambiar `ribbonCombination` en el config/job si se quiere reverso a color (con la cinta correspondiente cargada).

## Pendiente

- **Windows**: código implementado (`pdf-to-printer` + `side: 'duplex'`) pero sin probar en hardware real — falta validar en una máquina Windows con la Zebra conectada, y confirmar cómo configurar `RibbonCombination` ahí (ver arriba, "Al día — 2026-08-21").
- **Auto-actualización**: `electron-updater` ya está integrado en `main.js` (se activa solo en builds empaquetados, `app.isPackaged`), pero el `publish.url` en `package.json` sigue siendo un placeholder (`https://TODO-definir-servidor-de-releases/`). Falta decidir dónde se hospedan los releases (Isaac prefiere su propio servidor/Rails) y probar una actualización real de punta a punta.
- **Firma de código**: pendiente evaluar Apple Developer ID (Mac) y certificado de firma (Windows) antes de distribuir a clientes — sin esto el auto-update en Mac es poco confiable y Windows mostrará advertencias de SmartScreen.
- **Diseño final de credenciales**: falta el arte real (frente/reverso) para probar con contenido de producción en vez de las imágenes de prueba usadas aquí.

## Estructura del proyecto

```
main.js              — proceso principal: tray, arranque del server, autoUpdater
src/config.js         — carga/guarda config.json en userData
src/logger.js         — log a archivo plano
src/printEngine.js    — render HTML→PDF y llamada a lp/CUPS (o Windows, pendiente)
src/server.js         — API HTTP local (Express): /health, /printers, /preview, /print
build/icon.png, iconTemplate*.png — íconos de app y de bandeja
```
