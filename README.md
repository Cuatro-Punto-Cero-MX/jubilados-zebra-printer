# Credencial Print Agent

Agente local (Mac/Windows) que imprime credenciales por ambos lados en una Zebra ZC300 dual-sided sin
intervención manual. Corre en la bandeja del sistema y expone una API HTTP local para mandar trabajos
de impresión.

## Requisitos

- Impresora Zebra ZC300 **dual-sided** (con módulo de volteo automático) y driver oficial de Zebra instalado.
- Node.js 20+ para desarrollo/build.

## Uso en desarrollo

```
npm install
npm start
```

La app corre en la bandeja del sistema (sin ícono de dock) y expone:

- `GET  http://127.0.0.1:8942/health` — estado + impresora configurada.
- `GET  http://127.0.0.1:8942/printers` — impresoras del sistema.
- `POST http://127.0.0.1:8942/preview` — igual que `/print` pero regresa el PDF sin imprimir (útil para calibrar sin gastar tarjetas).
- `POST http://127.0.0.1:8942/print` — imprime. Body: `{ "frontImage": "<path>", "backImage": "<path>" }` (o `{ "pdfPath": "<path a PDF de 2 páginas>" }`).

La impresora se elige desde el menú de la bandeja del sistema. Config y logs en
`~/Library/Application Support/credencial-print-agent/` (`config.json`, `agent.log`).

## Arquitectura

```
main.js              — proceso principal: tray, arranque del server, autoUpdater
src/config.js         — carga/guarda config.json en userData
src/logger.js         — log a archivo plano
src/printEngine.js    — render HTML→PDF y llamada a lp/CUPS (Mac) / pendiente en Windows
src/server.js         — API HTTP local (Express): /health, /printers, /preview, /print
```

El dúplex se logra apoyándose en el driver oficial de Zebra: en Mac, mandando el PDF de la tarjeta
por CUPS con `lp -o DualSidePrinting=true` (más `RibbonCombination` si se necesita reverso a color) —
**no** con la API de impresión de alto nivel de Electron (`webContents.print({ duplexMode })`), porque
el driver Zebra expone el dúplex como una opción propia del PPD, no como el `sides` estándar de CUPS.

## Bugs encontrados y corregidos

1. **`webContents.print({ duplexMode })` no aplica** al driver Zebra — ver arriba. Se manda el PDF directo por `lp`.
2. **Imágenes `file://` no cargaban desde un documento `data:`** — Chromium bloquea recursos `file://` locales desde un documento `data:` (distinto origen). Fix: escribir el HTML a un archivo temporal real y usar `win.loadFile()`.
3. **`printToPDF({ pageSize: {...} })` en micrones producía PDFs en blanco** — a pesar de que la documentación clásica de Electron dice micrones, en Electron ^32 el valor correcto es **pulgadas**. Ya corregido en `src/printEngine.js` (`CARD_PAGE_SIZE`).
4. La combinación de cinta por default (`RibbonCombination = FrontYmcoBackK`) imprime el reverso siempre en negro/monocromo sin importar el color de la imagen fuente — el frente sale a color completo. Es esperado, no un bug.

## Pendiente

### 1. Hacerlo correr en Windows

Todavía no probado en una máquina Windows real. Pasos para llevarlo ahí:

1. **Instalar el driver Zebra para Windows** en la máquina cliente, desde la misma página de soporte del ZC300 (https://www.zebra.com/us/en/support-downloads/printers/card/zc300.html, sección Windows).
2. **Configurar el dúplex como default del driver, no por código.** A diferencia de Mac (donde pudimos mandar `-o DualSidePrinting=true` por línea de comandos vía CUPS), Windows no tiene CUPS — el driver expone sus opciones propias (equivalente a `DualSidePrinting`/`RibbonCombination`) a través de su propia pantalla de "Preferencias de impresión" (botón derecho sobre la impresora → Printing Preferences). Ahí hay que activar "imprimir en ambos lados" y la combinación de cinta correcta, y **guardarlo como default de esa impresora**. Cualquier trabajo que se mande después hereda esos defaults automáticamente — así que, igual que pasó en Mac (donde `DualSidePrinting=true` ya venía como default del PPD), lo más probable es que ni haga falta pasar flags especiales por código, solo mandar el PDF de 2 páginas a imprimir normal.
3. **Mandar el PDF a imprimir silenciosamente.** Windows no tiene un equivalente a `lp` de línea de comandos nativo. La opción más simple y probada en la comunidad de Electron es usar el paquete `pdf-to-printer` (envuelve SumatraPDF) o `PDFtoPrinter.exe` directamente:
   ```js
   const { print } = require('pdf-to-printer');
   await print(pdfPath, { printer: config.printerName });
   ```
   Esto imprime usando los defaults configurados en el paso 2. Si se necesita forzar `RibbonCombination` distinto por trabajo (no solo el default), hay que investigar si el driver expone esas opciones vía `DocumentProperties`/DEVMODE (requiere código nativo o PowerShell) — probablemente no haga falta para v1.
4. Implementar `printPdfWindows()` en `src/printEngine.js` (hoy es un stub que lanza error) usando lo anterior, seleccionado por `process.platform === 'win32'` (ese switch ya existe en `printJob()`).
5. Empaquetar con `npm run dist` (ya configurado `nsis` en `package.json`) e instalar en la máquina Windows de prueba.
6. Repetir la prueba física: `POST /print` con una tarjeta cargada, confirmar que sale por ambos lados sin voltear — igual que se validó en Mac.

### 2. Conectar el agente al backend de Rails

El contrato `POST /print` ya sirve como punto de enganche — no hace falta rediseñarlo. Falta decidir un
solo detalle según cómo esté desplegado Rails:

- **Si Rails corre en la misma red local que el cliente**: puede llamar directo a `http://127.0.0.1:8942/print` en la máquina del cliente (o a su IP de LAN si el puerto se expone más allá de localhost).
- **Si Rails está en la nube**: el agente local necesita jalar los trabajos en vez de que Rails le hable directo a la máquina del cliente — por polling (`GET` periódico a un endpoint tipo `/api/print_jobs/pending` en Rails) o vía websocket/ActionCable, marcando cada job como impreso cuando `/print` responde `ok`.

Esto también implica resolver autenticación entre el agente y Rails (un token por instalación/cliente,
guardado en el `config.json` del agente) para que no cualquiera en la red pueda mandarle trabajos de
impresión al agente.

### 3. Mandar a imprimir desde el backend

Una vez conectado (paso 2), en Rails: al generar/aprobar una credencial, en vez de (o además de) generar
un PDF para descarga, armar el payload `{ frontImage, backImage }` (o `{ pdfPath }` si Rails ya genera un
PDF de 2 páginas) y mandarlo al agente correspondiente (por HTTP directo si es LAN, o encolando el job
para que el agente lo jale si es polling/websocket). Conviene registrar el resultado (éxito/error) que
regresa `/print` en el modelo de la credencial en Rails, para poder reintentar o alertar si una impresión
falla (impresora sin cinta, sin tarjetas, apagada, etc. — casos que hoy `printPdfMac`/`printPdfWindows`
ya devuelven como error con mensaje).
