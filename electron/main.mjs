import { app, BrowserWindow, ipcMain, screen } from 'electron';
import http from 'node:http';
import https from 'node:https';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createFileLogger, serializeError } from './logger.mjs';
import { formatBeijingTimestamp, parseSinaQuote, parseZheshangQuote } from '../src/domain/goldQuote.mjs';
import { DEFAULT_SETTINGS, normalizeSettings } from '../src/domain/settings.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const logger = createFileLogger({ getDirectory: () => app.getPath('userData') });

const WINDOW_SIZES = {
  normal: { width: 360, height: 168 },
  compact: { width: 100, height: 30 },
  settings: { width: 420, height: 430 },
};

const SOURCES = {
  zheshang: {
    label: '浙商银行',
    url: 'https://api.tangdouz.com/a/zsgold.php',
    encoding: 'utf-8',
    parse: parseZheshangQuote,
  },
  sina: {
    label: '新浪',
    url: 'https://hq.sinajs.cn/list=SGE_AU9999',
    encoding: 'gb18030',
    parse: parseSinaQuote,
    headers: {
      Referer: 'https://finance.sina.com.cn/',
      'User-Agent': 'Mozilla/5.0 GoldDashboard/0.1',
    },
  },
};

let mainWindow;
let settingsWindow;
let normalBounds;
let currentMode = 'normal';
let shaking = false;
let settings = { ...DEFAULT_SETTINGS };
let dragState;

installErrorLogging();

logger.info('app starting', getRuntimeInfo());

app.whenReady().then(() => {
  logger.info('app ready', { logFile: logger.path });
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
}).catch((error) => {
  logger.error('app failed during startup', serializeError(error));
  throw error;
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

function createWindow() {
  logger.info('creating main window', { mode: currentMode, size: WINDOW_SIZES.normal });
  mainWindow = new BrowserWindow({
    width: WINDOW_SIZES.normal.width,
    height: WINDOW_SIZES.normal.height,
    minWidth: WINDOW_SIZES.compact.width,
    minHeight: WINDOW_SIZES.compact.height,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    alwaysOnTop: true,
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    hasShadow: false,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.setAlwaysOnTop(true, 'screen-saver');
  mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  mainWindow.once('ready-to-show', () => {
    logger.info('main window ready to show');
    mainWindow.show();
  });
  wireWindowLogging(mainWindow, 'main');
  wireMainWindowInteractions(mainWindow);

  if (app.isPackaged) {
    const filePath = path.join(__dirname, '../dist/index.html');
    logger.info('loading main window file', { filePath });
    mainWindow.loadFile(filePath).catch((error) => {
      logger.error('main window loadFile failed', serializeError(error));
    });
  } else {
    const url = process.env.VITE_DEV_SERVER_URL || 'http://127.0.0.1:5173';
    logger.info('loading main window url', { url });
    mainWindow.loadURL(url).catch((error) => {
      logger.error('main window loadURL failed', serializeError(error));
    });
  }
}

function createSettingsWindow() {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.focus();
    return settingsWindow;
  }

  settingsWindow = new BrowserWindow({
    width: WINDOW_SIZES.settings.width,
    height: WINDOW_SIZES.settings.height,
    minWidth: 360,
    minHeight: 380,
    frame: true,
    title: '金价面板设置',
    resizable: true,
    alwaysOnTop: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  settingsWindow.setMenuBarVisibility(false);
  settingsWindow.once('ready-to-show', () => settingsWindow?.show());
  wireWindowLogging(settingsWindow, 'settings');
  wireWindowShortcuts(settingsWindow);
  settingsWindow.on('closed', () => {
    settingsWindow = undefined;
  });

  if (app.isPackaged) {
    const filePath = path.join(__dirname, '../dist/index.html');
    logger.info('loading settings window file', { filePath });
    settingsWindow.loadFile(filePath, { query: { window: 'settings' } }).catch((error) => {
      logger.error('settings window loadFile failed', serializeError(error));
    });
  } else {
    const devUrl = new URL(process.env.VITE_DEV_SERVER_URL || 'http://127.0.0.1:5173');
    devUrl.searchParams.set('window', 'settings');
    logger.info('loading settings window url', { url: devUrl.toString() });
    settingsWindow.loadURL(devUrl.toString()).catch((error) => {
      logger.error('settings window loadURL failed', serializeError(error));
    });
  }

  return settingsWindow;
}

ipcMain.handle('gold:fetch', async (_event, sourceId = 'zheshang') => {
  const source = SOURCES[sourceId] ?? SOURCES.zheshang;

  try {
    const buffer = await requestBuffer(source.url, source.headers);
    const text = new TextDecoder(source.encoding).decode(buffer);
    const quote = {
      ...source.parse(text),
      updatedAt: formatBeijingTimestamp(),
    };
    logger.info('gold quote fetched', { source: source.label, price: quote.price, bytes: buffer.length });
    return quote;
  } catch (error) {
    logger.error('gold quote fetch failed', { source: source.label, error: serializeError(error) });
    throw error;
  }
});

ipcMain.handle('window:set-mode', (_event, mode) => {
  setWindowMode(mode === 'compact' ? 'compact' : 'normal');
  return currentMode;
});

ipcMain.handle('settings:open-window', () => {
  createSettingsWindow();
});

ipcMain.handle('settings:get', () => settings);

ipcMain.handle('settings:update', (_event, nextSettings) => {
  settings = normalizeSettings(nextSettings);
  logger.info('settings updated', {
    source: settings.source,
    backgroundColor: settings.backgroundColor,
    opacity: settings.opacity,
    hasAlertPrice: Boolean(settings.alertPrice),
  });
  BrowserWindow.getAllWindows().forEach((window) => {
    window.webContents.send('settings:changed', settings);
  });
  return settings;
});

ipcMain.on('settings:close-window', () => {
  settingsWindow?.close();
});

ipcMain.handle('window:shake', async () => {
  await shakeWindow();
});

ipcMain.on('window:close', () => {
  mainWindow?.close();
});

ipcMain.on('window:quit', () => {
  app.quit();
});

ipcMain.on('app:renderer-error', (event, payload) => {
  logger.error('renderer error', {
    url: event.sender.getURL(),
    payload,
  });
});

ipcMain.on('window:drag-start', (_event, point) => {
  if (!mainWindow || currentMode !== 'compact') {
    return;
  }

  dragState = {
    startPoint: normalizePoint(point),
    startBounds: mainWindow.getBounds(),
  };
});

ipcMain.on('window:drag-move', (_event, point) => {
  if (!mainWindow || !dragState || currentMode !== 'compact') {
    return;
  }

  const currentPoint = normalizePoint(point);
  const nextX = Math.round(dragState.startBounds.x + currentPoint.x - dragState.startPoint.x);
  const nextY = Math.round(dragState.startBounds.y + currentPoint.y - dragState.startPoint.y);
  mainWindow.setPosition(nextX, nextY, false);
});

ipcMain.on('window:drag-end', () => {
  dragState = undefined;
});

function setWindowMode(mode) {
  if (!mainWindow) {
    return;
  }

  if (mode === 'compact') {
    normalBounds = mainWindow.getBounds();
    currentMode = 'compact';
    const edgeBounds = getNearestEdgeBounds(normalBounds);
    mainWindow.setBounds(edgeBounds, true);
  } else {
    currentMode = 'normal';
    const nextBounds = normalBounds
      ? { x: normalBounds.x, y: normalBounds.y, ...WINDOW_SIZES.normal }
      : { ...mainWindow.getBounds(), ...WINDOW_SIZES.normal };
    mainWindow.setBounds(nextBounds, true);
  }

  mainWindow.webContents.send('ui:window-mode-changed', currentMode);
  logger.info('window mode changed', { mode: currentMode, bounds: mainWindow.getBounds() });
}

function toggleCompactMode() {
  setWindowMode(currentMode === 'compact' ? 'normal' : 'compact');
}

function wireMainWindowInteractions(window) {
  wireWindowShortcuts(window);
}

function wireWindowShortcuts(window) {
  window.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') {
      return;
    }

    if (input.key?.toLowerCase() === 's' && !input.control && !input.meta && !input.alt) {
      event.preventDefault();
      createSettingsWindow();
    }

    if (input.key?.toLowerCase() === 'm' && !input.control && !input.meta && !input.alt) {
      event.preventDefault();
      toggleCompactMode();
    }

    if (input.key?.toLowerCase() === 'q' && (input.control || input.meta) && !input.alt) {
      event.preventDefault();
      app.quit();
    }
  });
}

function normalizePoint(point) {
  return {
    x: Number(point?.x) || 0,
    y: Number(point?.y) || 0,
  };
}

function getNearestEdgeBounds(bounds) {
  const display = screen.getDisplayMatching(bounds).workArea;
  const compact = WINDOW_SIZES.compact;
  const centerX = bounds.x + bounds.width / 2;
  const leftDistance = Math.abs(centerX - display.x);
  const rightDistance = Math.abs(display.x + display.width - centerX);
  const x = leftDistance <= rightDistance ? display.x : display.x + display.width - compact.width;
  const y = Math.min(Math.max(bounds.y, display.y), display.y + display.height - compact.height);

  return { x, y, ...compact };
}

async function shakeWindow() {
  if (!mainWindow || shaking) {
    return;
  }

  shaking = true;
  const original = mainWindow.getBounds();
  const offsets = [-10, 10, -8, 8, -6, 6, 0];

  for (const offset of offsets) {
    mainWindow.setBounds({ ...original, x: original.x + offset }, false);
    await delay(42);
  }

  mainWindow.setBounds(original, false);
  shaking = false;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function requestBuffer(url, headers = {}, redirectCount = 0) {
  return new Promise((resolve, reject) => {
    if (redirectCount > 5) {
      reject(new Error(`接口重定向次数过多：${url}`));
      return;
    }

    const parsedUrl = new URL(url);
    const client = parsedUrl.protocol === 'https:' ? https : http;
    const request = client.request(parsedUrl, { method: 'GET', headers, timeout: 10_000 }, (response) => {
      const statusCode = response.statusCode ?? 0;

      if (statusCode >= 300 && statusCode < 400 && response.headers.location) {
        response.resume();
        const nextUrl = new URL(response.headers.location, parsedUrl).toString();
        requestBuffer(nextUrl, headers, redirectCount + 1).then(resolve, reject);
        return;
      }

      if (statusCode < 200 || statusCode >= 300) {
        response.resume();
        reject(new Error(`接口请求失败：${statusCode}`));
        return;
      }

      const chunks = [];
      response.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
      response.on('end', () => resolve(Buffer.concat(chunks)));
    });

    request.on('timeout', () => {
      request.destroy(new Error(`接口请求超时：${url}`));
    });
    request.on('error', reject);
    request.end();
  });
}

function installErrorLogging() {
  process.on('uncaughtException', (error) => {
    logger.error('uncaught exception', serializeError(error));
    app.exit(1);
  });

  process.on('unhandledRejection', (reason) => {
    logger.error('unhandled rejection', serializeError(reason));
    app.exit(1);
  });

  app.on('child-process-gone', (_event, details) => {
    logger.error('child process gone', details);
  });

  app.on('render-process-gone', (_event, webContents, details) => {
    logger.error('render process gone', {
      url: webContents?.getURL?.(),
      details,
    });
  });
}

function wireWindowLogging(window, name) {
  window.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
    logger.error(`${name} window failed to load`, {
      errorCode,
      errorDescription,
      validatedURL,
      isMainFrame,
    });
  });

  window.webContents.on('render-process-gone', (_event, details) => {
    logger.error(`${name} window render process gone`, details);
  });

  window.webContents.on('console-message', (_event, level, message, line, sourceId) => {
    if (level >= 1) {
      logger.warn(`${name} window console`, { level, message, line, sourceId });
    }
  });
}

function getRuntimeInfo() {
  return {
    appVersion: app.getVersion(),
    platform: process.platform,
    arch: process.arch,
    osRelease: process.getSystemVersion?.(),
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
    v8: process.versions.v8,
  };
}
