const { app, dialog } = require('electron');
const { log } = require('./logger');

// Envuelve electron-updater con: un chequeo silencioso al arrancar y un chequeo
// "a mano" (desde el menú de la bandeja) que sí da feedback en diálogos, ya que
// la app no tiene ventana. Con `autoDownload` en true, un `checkForUpdates()` que
// encuentra versión nueva la descarga sola y dispara `update-downloaded`.

let updater = null;
let wired = false;
let inFlight = false;
// true mientras el chequeo en curso lo pidió el usuario — controla si se muestran
// los diálogos de "ya estás al día" / error (molestos si fueran en cada arranque).
let interactive = false;

function getUpdater() {
  if (!updater) {
    updater = require('electron-updater').autoUpdater;
    updater.logger = { info: log, warn: log, error: log, debug: () => {} };
    updater.autoDownload = true;
    updater.autoInstallOnAppQuit = true;
  }
  return updater;
}

function done() {
  inFlight = false;
  interactive = false;
}

function wire() {
  if (wired) return;
  wired = true;
  const u = getUpdater();

  u.on('checking-for-update', () => log('buscando actualizaciones…'));

  u.on('update-available', (info) => {
    log(`update-available: ${info.version} (actual ${app.getVersion()})`);
    if (interactive) {
      dialog.showMessageBox({
        type: 'info',
        title: 'Actualización disponible',
        message: `Hay una versión nueva (${info.version}).`,
        detail: 'Se está descargando; te aviso cuando esté lista para instalar.',
      });
    }
  });

  u.on('update-not-available', () => {
    log(`sin actualizaciones (versión actual ${app.getVersion()})`);
    if (interactive) {
      dialog.showMessageBox({
        type: 'info',
        title: 'Sin actualizaciones',
        message: `Ya tienes la última versión (${app.getVersion()}).`,
      });
    }
    done();
  });

  u.on('download-progress', (p) => log(`descargando actualización: ${Math.round(p.percent)}%`));

  u.on('update-downloaded', (info) => {
    log(`update-downloaded: ${info.version}`);
    dialog
      .showMessageBox({
        type: 'info',
        title: 'Actualización lista',
        message: `La versión ${info.version} está lista.`,
        detail: 'La app se cierra y se vuelve a abrir para aplicarla.',
        buttons: ['Reiniciar ahora', 'Después'],
        defaultId: 0,
        cancelId: 1,
      })
      .then(({ response }) => {
        if (response === 0) setImmediate(() => getUpdater().quitAndInstall());
      });
    done();
  });

  u.on('error', (err) => {
    log(`autoUpdater error: ${err == null ? 'desconocido' : err.stack || err.message || err}`);
    if (interactive) {
      dialog.showMessageBox({
        type: 'error',
        title: 'Error al actualizar',
        message: 'No se pudo completar la actualización.',
        detail: String((err && err.message) || err),
      });
    }
    done();
  });
}

// Chequeo silencioso al arrancar. Si hay versión nueva se descarga y el diálogo
// de "Reiniciar ahora" aparece igual (ese no depende de `interactive`).
function initAutoUpdater() {
  if (!app.isPackaged) {
    log('electron-updater desactivado (app sin empaquetar)');
    return;
  }
  try {
    wire();
    inFlight = true;
    interactive = false;
    getUpdater()
      .checkForUpdates()
      .catch((err) => {
        log(`checkForUpdates (arranque) falló: ${err.message}`);
        done();
      });
  } catch (err) {
    log(`No se pudo inicializar electron-updater: ${err.message}`);
  }
}

// Disparado desde el menú de la bandeja ("Buscar actualizaciones ahora").
function checkForUpdatesNow() {
  if (!app.isPackaged) {
    dialog.showMessageBox({
      type: 'info',
      title: 'Modo desarrollo',
      message: 'El auto-update solo corre en la app instalada (.exe), no desde código fuente.',
    });
    return;
  }
  if (inFlight) {
    log('checkForUpdatesNow: ya hay un chequeo en curso');
    return;
  }
  try {
    wire();
    inFlight = true;
    interactive = true;
    getUpdater()
      .checkForUpdates()
      .catch((err) => {
        log(`checkForUpdatesNow falló: ${err.message}`);
        dialog.showMessageBox({
          type: 'error',
          title: 'Error al buscar actualizaciones',
          message: String(err.message || err),
        });
        done();
      });
  } catch (err) {
    log(`checkForUpdatesNow error: ${err.message}`);
    done();
  }
}

module.exports = { initAutoUpdater, checkForUpdatesNow };
