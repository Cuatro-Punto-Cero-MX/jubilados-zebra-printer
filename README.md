# Credencial Print Agent

Agente local (Mac/Windows) que imprime credenciales por ambos lados en una Zebra ZC300 dual-sided sin
intervención manual. Corre en la bandeja del sistema y expone una API HTTP local para mandar trabajos
de impresión. El backend Rails (`sistema-web-para-credencializacion`) le manda trabajos desde el
navegador del usuario — ver "Cómo se conecta con Rails" más abajo.

## Requisitos

- Impresora Zebra ZC300 **dual-sided** (con módulo de volteo automático) y driver oficial de Zebra
  instalado para Windows.
- Node.js 20+ (solo para correrlo desde código fuente / generar el instalador — el `.exe` final no lo
  necesita en la máquina donde se instala).

## Cómo ponerlo a correr en una máquina Windows (para el equipo)

Esto es lo que hay que hacer en la computadora de recepción que tiene la Zebra ZC300 conectada.

1. **Instalar el driver Zebra para Windows.**
   Descárgalo de la página de soporte del ZC300:
   https://www.zebra.com/us/en/support-downloads/printers/card/zc300.html (sección Windows).
   Instálalo y conecta la impresora — debe aparecer en "Dispositivos e impresoras" de Windows.

2. **Configurar el dúplex y la cinta como default del driver.**
   Windows no tiene CUPS como Mac, así que estas opciones no se mandan por código: hay que dejarlas
   guardadas como default de la impresora, una sola vez.
   - Clic derecho sobre la impresora Zebra → **Printing Preferences** (Preferencias de impresión).
   - Activa "imprimir en ambos lados" / dúplex.
   - Configura la combinación de cinta (`RibbonCombination`) que corresponda a la cinta que tengas
     cargada (color en el frente, negro en el reverso es el default más común).
   - Guarda como default de esa impresora. Cualquier trabajo que el agente mande después hereda estos
     defaults automáticamente.

3. **Instalar Node.js 20+** (https://nodejs.org, versión LTS) si vas a correr el agente desde código
   fuente. Si ya tienes un instalador `.exe` empaquetado (ver "Generar el instalador" abajo), sáltate
   este paso y el siguiente.

4. **Descargar este proyecto y correrlo:**
   ```
   cd zebra_zc300
   npm install
   npm start
   ```
   La app no abre ninguna ventana — corre en la bandeja del sistema (junto al reloj, ícono de
   "Credencial Print Agent"). Si no lo ves, revisa la flecha de "mostrar íconos ocultos" de la bandeja.

5. **Elegir la impresora desde el ícono de la bandeja.**
   Clic derecho en el ícono → bajo "Impresora:" aparecen todas las impresoras que ve Windows → elige la
   Zebra ZC300. Queda guardado en `%APPDATA%\credencial-print-agent\config.json` y persiste entre
   reinicios.

6. **Probar que responde:**
   Abre `http://127.0.0.1:8942/health` en un navegador — debe regresar
   `{"ok":true,"printer":"<nombre de tu impresora>","platform":"win32"}`.
   Si `printer` sale `null`, falta el paso 5.

7. **Probar una impresión real** desde la pantalla de un afiliado en la app Rails
   (`personas#show` → botón "Imprimir credencial"), con una tarjeta cargada en la ZC300. Debe salir
   impresa por ambos lados sin necesidad de voltearla manualmente.

   Si algo falla, el error se ve en la respuesta HTTP y queda registrado en
   `%APPDATA%\credencial-print-agent\agent.log` (accesible también desde el menú de la bandeja → "Ver
   logs").

⚠️ **Esto todavía no se ha probado en hardware Windows real** (se desarrolló y probó solo en Mac). El
código de impresión para Windows (`printPdfWindows` en `src/printEngine.js`, vía el paquete
`pdf-to-printer`) está implementado pero es la primera vez que alguien lo corre contra una ZC300 física
en Windows — si algo no funciona como se describe arriba, es información nueva y vale la pena
documentarla en `NOTES.md`.

### Generar un instalador (`.exe`) para no depender de Node en la máquina final

```
npm run dist
```

Esto usa `electron-builder` (configurado como `nsis` en `package.json`) y deja un instalador en `dist/`.
Instalarlo en la máquina Windows evita los pasos 3-4 de arriba — el resto (driver Zebra, elegir
impresora desde la bandeja) sigue igual. Nota: el auto-updater (`electron-updater`, ya integrado en
`main.js`) todavía no tiene un servidor de releases real configurado (`build.publish.url` en
`package.json` es un placeholder) — por ahora hay que redistribuir el instalador a mano cada vez que
cambie el código.

## API HTTP local

- `GET  http://127.0.0.1:8942/health` — estado + impresora configurada.
- `GET  http://127.0.0.1:8942/printers` — impresoras que ve el sistema.
- `POST http://127.0.0.1:8942/preview` — igual que `/print` pero regresa el PDF sin imprimir (útil para
  calibrar sin gastar tarjetas).
- `POST http://127.0.0.1:8942/print` — imprime. Body: `{ "frontImage": "<path>", "backImage": "<path>" }`
  (o `{ "pdfPath": "<path a PDF de 2 páginas>" }`).

Solo escucha en `127.0.0.1` (nunca expuesto a la red), pero acepta llamadas CORS desde cualquier origen
(`src/server.js`) porque quien llama es JavaScript corriendo en el navegador sobre el dominio de Rails,
no el propio backend.

## Cómo se conecta con Rails

El botón "Imprimir credencial" en `personas#show` (app Rails) dispara el flujo desde el **navegador**,
no desde el backend: el navegador, ya autenticado con la sesión de Devise, descarga las imágenes de la
credencial, las convierte a `data:` URI, y llama directo a `POST http://127.0.0.1:8942/print`. Nunca
pasa por el backend Rails — en producción Rails corre en un servidor remoto que no podría alcanzar el
`127.0.0.1` de la máquina de recepción, pero el navegador de esa misma máquina sí puede.

## Config y logs

`%APPDATA%\credencial-print-agent\` en Windows (`~/Library/Application Support/credencial-print-agent/`
en Mac): `config.json` (puerto, impresora elegida, `ribbonCombination`) y `agent.log`. Ambos accesibles
desde el menú de la bandeja del sistema ("Ver config" / "Ver logs").

## Arquitectura

```
main.js              — proceso principal: tray, arranque del server, autoUpdater
src/config.js         — carga/guarda config.json en userData
src/logger.js         — log a archivo plano
src/printEngine.js    — render HTML→PDF y llamada a lp/CUPS (Mac) o pdf-to-printer/SumatraPDF (Windows)
src/server.js         — API HTTP local (Express): /health, /printers, /preview, /print
```

En Mac el dúplex se logra mandando el PDF por CUPS con `lp -o DualSidePrinting=true` (más
`RibbonCombination` si se necesita). En Windows no hay CUPS, así que se manda el PDF vía el paquete
`pdf-to-printer` (trae SumatraPDF empaquetado) con `side: 'duplex'`, apoyándose en los defaults del
driver Zebra configurados en el paso 2 de arriba — por eso es importante dejar el dúplex y la cinta
guardados como default ahí, no solo por código.

## Bugs encontrados y corregidos

1. **`webContents.print({ duplexMode })` no aplica** al driver Zebra — el driver expone el dúplex como
   opción propia del PPD/driver, no como el estándar de la API de impresión de Electron. Se manda el PDF
   directo por `lp` (Mac) / `pdf-to-printer` (Windows) en vez de usar esa API de alto nivel.
2. **Imágenes `file://` no cargaban desde un documento `data:`** — Chromium bloquea recursos `file://`
   locales desde un documento `data:` (distinto origen). Fix: escribir el HTML a un archivo temporal
   real y usar `win.loadFile()`.
3. **`printToPDF({ pageSize: {...} })` en micrones producía PDFs en blanco** — a pesar de que la
   documentación clásica de Electron dice micrones, el valor correcto es **pulgadas**. Ya corregido en
   `src/printEngine.js` (`CARD_PAGE_SIZE`).
4. La combinación de cinta por default (`RibbonCombination = FrontYmckoBackK`) imprime el reverso
   siempre en negro/monocromo sin importar el color de la imagen fuente — el frente sale a color
   completo. Es esperado, no un bug.
5. **Empaquetado incompleto**: el `"files"` del bloque `"build"` en `package.json` no incluía
   `node_modules`, así que ni `express` ni `electron-updater` se empaquetaban en el instalador final. Ya
   corregido (`"node_modules/**/*"` agregado a `files`).

## Pendiente

- **Validar en hardware Windows real** — ver la advertencia arriba.
- **Auto-actualización**: `electron-updater` ya está integrado, pero `build.publish.url` en
  `package.json` sigue siendo un placeholder. Falta decidir dónde se hospedan los releases y probar una
  actualización real de punta a punta.
- **Firma de código**: pendiente evaluar certificado de firma para Windows (sin esto, Windows va a
  mostrar advertencias de SmartScreen al instalar) y Apple Developer ID para Mac.
- **Combinación de cinta a color en el reverso**: confirmar con el cliente si quiere invertir en la
  cinta a color para el reverso y documentar el valor exacto de `RibbonCombination` a usar.

Ver `NOTES.md` para la bitácora completa de la sesión de desarrollo (fecha por fecha).
