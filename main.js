const { app, Tray, Menu, nativeImage, shell } = require('electron');
const path = require('path');
const { loadConfig, saveConfig, configPath } = require('./src/config');
const { startServer } = require('./src/server');
const { listPrinters } = require('./src/printEngine');
const { log, logPath } = require('./src/logger');
const { initAutoUpdater, checkForUpdatesNow } = require('./src/updater');

let tray = null;
let server = null;
let config = null;

// La app no tiene ventana ni consola visible cuando está empaquetada: sin esto,
// cualquier excepción en el arranque la mata en silencio (ni bandeja ni error).
process.on('uncaughtException', (err) => log(`uncaughtException: ${err && err.stack || err}`));
process.on('unhandledRejection', (reason) => log(`unhandledRejection: ${reason && reason.stack || reason}`));

function trayIconPath() {
  // En macOS, un archivo *Template.png hace que el ícono se adapte a modo claro/oscuro.
  return process.platform === 'darwin'
    ? path.join(__dirname, 'build', 'iconTemplate.png')
    : path.join(__dirname, 'build', 'icon.png');
}

async function buildTrayMenu() {
  let printerItems;
  try {
    const printers = await listPrinters();
    printerItems = printers.length
      ? printers.map((p) => ({
          label: (p.name === config.printerName ? '✓ ' : '   ') + p.name,
          click: () => {
            config.printerName = p.name;
            saveConfig(config);
            refreshTray();
          },
        }))
      : [{ label: '(no se detectaron impresoras)', enabled: false }];
  } catch (err) {
    printerItems = [{ label: `Error listando impresoras: ${err.message}`, enabled: false }];
  }

  return Menu.buildFromTemplate([
    { label: `Credencial Print Agent v${app.getVersion()}`, enabled: false },
    { label: `API local: http://127.0.0.1:${config.port}`, enabled: false },
    { type: 'separator' },
    { label: 'Impresora:', enabled: false },
    ...printerItems,
    { type: 'separator' },
    { label: 'Buscar actualizaciones ahora', click: () => checkForUpdatesNow() },
    { label: 'Ver logs', click: () => shell.showItemInFolder(logPath()) },
    { label: 'Ver config', click: () => shell.showItemInFolder(configPath()) },
    { type: 'separator' },
    { label: 'Salir', click: () => app.quit() },
  ]);
}

async function refreshTray() {
  const menu = await buildTrayMenu();
  tray.setContextMenu(menu);
}

app.whenReady().then(async () => {
  if (process.platform === 'darwin' && app.dock) {
    app.dock.hide();
  }

  config = loadConfig();
  server = startServer(config);

  // En Windows `new Tray()` con una imagen vacía (ícono no encontrado en el
  // paquete) lanza y tumba el arranque. Se degrada a un ícono vacío y se deja
  // constancia en el log en vez de morir — el servidor HTTP ya está arriba.
  let trayImage = nativeImage.createFromPath(trayIconPath());
  if (trayImage.isEmpty()) {
    log(`Ícono de bandeja no encontrado en ${trayIconPath()}; usando ícono vacío`);
    trayImage = nativeImage.createEmpty();
  }
  try {
    tray = new Tray(trayImage);
    tray.setToolTip('Credencial Print Agent');
    await refreshTray();
  } catch (err) {
    log(`No se pudo crear el ícono de bandeja: ${err.message}. El agente sigue corriendo en 127.0.0.1:${config.port}.`);
  }

  initAutoUpdater();
});

app.on('window-all-closed', (event) => {
  // La app vive en la bandeja del sistema; no debe cerrarse al no tener ventanas.
  event.preventDefault();
});

app.on('before-quit', () => {
  server?.close();
});
