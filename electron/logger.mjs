import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const LOG_FILE_NAME = 'gold-dashboard.log';
const FALLBACK_APP_NAME = '实时金价面板';

export function createFileLogger({ getDirectory, fileName = LOG_FILE_NAME, now = () => new Date() } = {}) {
  let cachedPath;

  function getLogFilePath() {
    if (cachedPath) {
      return cachedPath;
    }

    const directory = resolveLogDirectory(getDirectory);
    fs.mkdirSync(directory, { recursive: true });
    cachedPath = path.join(directory, fileName);
    return cachedPath;
  }

  function write(level, message, details) {
    const suffix = details === undefined ? '' : ` ${formatDetails(details)}`;
    const line = `[${now().toISOString()}] [${level}] ${message}${suffix}\n`;

    try {
      fs.appendFileSync(getLogFilePath(), line, 'utf8');
    } catch (error) {
      console.error('Failed to write gold dashboard log:', error);
      console.error(line.trimEnd());
    }
  }

  return {
    get path() {
      return getLogFilePath();
    },
    info: (message, details) => write('INFO', message, details),
    warn: (message, details) => write('WARN', message, details),
    error: (message, details) => write('ERROR', message, details),
  };
}

export function serializeError(error) {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
      code: error.code,
    };
  }

  return error;
}

function resolveLogDirectory(getDirectory) {
  try {
    const directory = getDirectory?.();
    if (directory) {
      return directory;
    }
  } catch {
    // Fall back below; logging must not block app startup.
  }

  const home = os.homedir();

  if (process.platform === 'win32') {
    return path.join(process.env.APPDATA || process.env.LOCALAPPDATA || home || process.cwd(), FALLBACK_APP_NAME);
  }

  if (process.platform === 'darwin') {
    return path.join(home || process.cwd(), 'Library', 'Application Support', FALLBACK_APP_NAME);
  }

  return path.join(process.env.XDG_CONFIG_HOME || path.join(home || process.cwd(), '.config'), FALLBACK_APP_NAME);
}

function formatDetails(details) {
  try {
    return JSON.stringify(details, (_key, value) => serializeError(value));
  } catch (error) {
    return JSON.stringify({
      details: String(details),
      stringifyError: serializeError(error),
    });
  }
}
