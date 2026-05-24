import { app, BrowserWindow, ipcMain } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const preload = path.join(root, 'electron/preload.cjs');
console.log('visual-check: boot');

main().catch((error) => {
  console.error(error);
  app.quit();
  setTimeout(() => process.exit(1), 50);
});

async function main() {
  await withTimeout(app.whenReady(), 10_000, 'Electron app readiness timed out');
  console.log('visual-check: app ready');

  const win = new BrowserWindow({
    width: 360,
    height: 168,
    show: false,
    frame: false,
    transparent: true,
    webPreferences: {
      preload,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  await win.loadFile(path.join(root, 'dist/index.html'));
  await wait(500);
  console.log('visual-check: dashboard loaded');

  const dashboard = await win.webContents.executeJavaScript(`
    ({
      price: document.querySelector('.price-line')?.textContent,
      meta: document.querySelector('.meta-line')?.textContent,
      hint: document.querySelector('.hint-line')?.textContent,
      hasVerticalOverflow: document.documentElement.scrollHeight > window.innerHeight,
      hasHorizontalOverflow: document.documentElement.scrollWidth > window.innerWidth
    })
  `);

  assert.match(dashboard.price, /元\/克/);
  assert.match(dashboard.meta, /API：/);
  assert.match(dashboard.hint, /M 小窗/);
  assert.equal(dashboard.hasVerticalOverflow, false);
  assert.equal(dashboard.hasHorizontalOverflow, false);
  console.log('visual-check: dashboard ok');

  const settingsWin = new BrowserWindow({
    width: 420,
    height: 430,
    show: false,
    frame: true,
    webPreferences: {
      preload,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  await settingsWin.loadFile(path.join(root, 'dist/index.html'), { query: { window: 'settings' } });
  await wait(300);
  console.log('visual-check: settings loaded');

  const settings = await settingsWin.webContents.executeJavaScript(`
    ({
      title: document.querySelector('.settings-header h1')?.textContent,
      fields: [...document.querySelectorAll('.field span')].map((node) => node.textContent),
      hasCustomCloseButton: Boolean(document.querySelector('[aria-label="关闭设置"]')),
      hasHorizontalOverflow: document.documentElement.scrollWidth > window.innerWidth
    })
  `);

  assert.equal(settings.title, '设置');
  assert.deepEqual(settings.fields.slice(0, 4), ['API 源', '背景颜色', '透明度：50%', '预警价格（元/克）']);
  assert.equal(settings.hasCustomCloseButton, false);
  assert.equal(settings.hasHorizontalOverflow, false);
  console.log('visual-check: settings ok');

  const bridgeShape = await settingsWin.webContents.executeJavaScript(`
    ({
      hasBridge: Boolean(window.goldDashboard),
      keys: Object.keys(window.goldDashboard ?? {})
    })
  `);
  console.log('visual-check: bridge', bridgeShape);

  await settingsWin.webContents.executeJavaScript(`
    window.goldDashboard.updateSettings({
      source: 'sina',
      backgroundColor: '#112233',
      opacity: 25,
      alertPrice: '1000.50'
    })
  `);
  await wait(300);

  const syncedDashboard = await win.webContents.executeJavaScript(`
    ({
      hint: document.querySelector('.hint-line')?.textContent,
      panelBackground: getComputedStyle(document.querySelector('.panel')).backgroundColor
    })
  `);

  assert.match(syncedDashboard.hint, /1000\.50 元/);
  assert.equal(syncedDashboard.panelBackground, 'rgba(17, 34, 51, 0.25)');

  await settingsWin.webContents.executeJavaScript(`window.goldDashboard.setWindowMode('compact')`);
  await wait(100);
  assert.deepEqual(win.getBounds(), { ...win.getBounds(), width: 100, height: 30 });
  console.log('visual-check: settings sync ok');

  settingsWin.destroy();
  win.destroy();
  app.quit();
}

ipcMain.handle('gold:fetch', async (_event, source = 'zheshang') => ({
  source,
  sourceLabel: source === 'sina' ? '新浪' : '浙商银行',
  price: source === 'sina' ? 991 : 988.88,
  baseline: 987.77,
  updatedAt: '2026/5/24 15:00:00',
}));

let visualSettings = {
  source: 'zheshang',
  backgroundColor: '#333333',
  opacity: 50,
  alertPrice: '',
};

ipcMain.handle('settings:get', () => visualSettings);

ipcMain.handle('settings:update', (_event, nextSettings) => {
  visualSettings = nextSettings;
  BrowserWindow.getAllWindows().forEach((window) => {
    window.webContents.send('settings:changed', visualSettings);
  });
  return visualSettings;
});

ipcMain.handle('window:set-mode', (event, mode) => {
  const dashboardWindow = BrowserWindow.getAllWindows().find((window) => !window.webContents.getURL().includes('window=settings'));
  if (mode === 'compact') {
    dashboardWindow?.setBounds({ ...dashboardWindow.getBounds(), width: 100, height: 30 });
  }
  event.sender.send('ui:window-mode-changed', mode);
  dashboardWindow?.webContents.send('ui:window-mode-changed', mode);
  return mode;
});

ipcMain.handle('settings:open-window', () => {});
ipcMain.handle('window:shake', () => {});
ipcMain.on('settings:close-window', () => {});
ipcMain.on('window:close', () => {});
ipcMain.on('window:quit', () => {});

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function withTimeout(promise, ms, message) {
  return Promise.race([
    promise,
    new Promise((_resolve, reject) => {
      setTimeout(() => reject(new Error(message)), ms);
    }),
  ]);
}
