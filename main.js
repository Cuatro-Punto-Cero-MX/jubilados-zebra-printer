const { app, Tray, Menu, nativeImage, shell } = require('electron');
const path = require('path');
const { loadConfig, saveConfig, configPath } = require('./src/config');
const { startServer } = require('./src/server');
const { listPrinters } = require('./src/printEngine');
const { log, logPath } = require('./src/logger');

let tray = null;
let server = null;
let config = null;

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

  tray = new Tray(nativeImage.createFromPath(trayIconPath()));
  tray.setToolTip('Credencial Print Agent');
  await refreshTray();

  if (app.isPackaged) {
    try {
      const { autoUpdater } = require('electron-updater');
      autoUpdater.logger = { info: log, warn: log, error: log, debug: () => {} };
      autoUpdater.checkForUpdatesAndNotify().catch((err) => log(`autoUpdater error: ${err.message}`));
    } catch (err) {
      log(`No se pudo inicializar electron-updater: ${err.message}`);
    }
  }
});

app.on('window-all-closed', (event) => {
  // La app vive en la bandeja del sistema; no debe cerrarse al no tener ventanas.
  event.preventDefault();
});

app.on('before-quit', () => {
  server?.close();
});
