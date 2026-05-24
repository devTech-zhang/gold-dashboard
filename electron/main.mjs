import { app, BrowserWindow, ipcMain, screen } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { formatBeijingTimestamp, parseSinaQuote, parseZheshangQuote } from '../src/domain/goldQuote.mjs';
import { DEFAULT_SETTINGS, normalizeSettings } from '../src/domain/settings.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

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

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

function createWindow() {
  mainWindow = new BrowserWindow({
    width: WINDOW_SIZES.normal.width,
    height: WINDOW_SIZES.normal.height,
    minWidth: WINDOW_SIZES.compact.width,
    minHeight: WINDOW_SIZES.compact.height,
    frame: false,
    transparent: true,
    roundedCorners: true,
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
  mainWindow.once('ready-to-show', () => mainWindow.show());
  wireMainWindowInteractions(mainWindow);

  if (app.isPackaged) {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  } else {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL || 'http://127.0.0.1:5173');
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
  wireWindowShortcuts(settingsWindow);
  settingsWindow.on('closed', () => {
    settingsWindow = undefined;
  });

  if (app.isPackaged) {
    settingsWindow.loadFile(path.join(__dirname, '../dist/index.html'), { query: { window: 'settings' } });
  } else {
    const devUrl = new URL(process.env.VITE_DEV_SERVER_URL || 'http://127.0.0.1:5173');
    devUrl.searchParams.set('window', 'settings');
    settingsWindow.loadURL(devUrl.toString());
  }

  return settingsWindow;
}

ipcMain.handle('gold:fetch', async (_event, sourceId = 'zheshang') => {
  const source = SOURCES[sourceId] ?? SOURCES.zheshang;
  const response = await fetch(source.url, { headers: source.headers });

  if (!response.ok) {
    throw new Error(`${source.label}接口请求失败：${response.status}`);
  }

  const buffer = await response.arrayBuffer();
  const text = new TextDecoder(source.encoding).decode(buffer);
  return {
    ...source.parse(text),
    updatedAt: formatBeijingTimestamp(),
  };
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
