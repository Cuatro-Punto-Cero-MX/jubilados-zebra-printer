const { app } = require('electron');
const fs = require('fs');
const path = require('path');

function logPath() {
  return path.join(app.getPath('userData'), 'agent.log');
}

function log(message) {
  const line = `[${new Date().toISOString()}] ${message}`;
  try {
    fs.mkdirSync(path.dirname(logPath()), { recursive: true });
    fs.appendFileSync(logPath(), line + '\n');
  } catch {
    // si no se puede escribir el log no debe tumbar el print job
  }
  console.log(line);
}

module.exports = { log, logPath };
