const { app } = require('electron');
const fs = require('fs');
const path = require('path');

function configPath() {
  return path.join(app.getPath('userData'), 'config.json');
}

const DEFAULTS = {
  port: 8942,
  printerName: null,
  // Nombre exacto de la RibbonCombination del PPD de Zebra a forzar (ej. 'FrontYmckoBackYmcko'
  // para reverso a color). Null = usa el default del driver (frente color, reverso negro).
  ribbonCombination: null,
};

function loadConfig() {
  try {
    const raw = fs.readFileSync(configPath(), 'utf8');
    return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULTS };
  }
}

function saveConfig(config) {
  fs.mkdirSync(path.dirname(configPath()), { recursive: true });
  fs.writeFileSync(configPath(), JSON.stringify(config, null, 2));
}

module.exports = { loadConfig, saveConfig, configPath };
