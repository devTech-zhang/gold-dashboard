import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';

import { PRICE_REFRESH_INTERVAL_MS } from './domain/config.mjs';
import { formatQuote, shouldTriggerAlert } from './domain/goldQuote.mjs';
import { DEFAULT_SETTINGS, normalizeSettings } from './domain/settings.mjs';
import './styles.css';

const bridge = window.goldDashboard ?? {
  fetchGoldQuote: async (source) => ({
    source,
    sourceLabel: source === 'sina' ? '新浪' : '浙商银行',
    price: 988.88,
    baseline: 987.77,
    change: 1.11,
    changePercent: 0.11,
    updatedAt: new Date().toLocaleString('zh-CN'),
  }),
  setWindowMode: async () => {},
  openSettingsWindow: async () => {},
  closeSettingsWindow: () => {},
  getSettings: async () => DEFAULT_SETTINGS,
  updateSettings: async (settings) => normalizeSettings(settings),
  logRendererError: () => {},
  closeWindow: () => {},
  quitApp: () => {},
  startWindowDrag: () => {},
  moveWindowDrag: () => {},
  endWindowDrag: () => {},
  shakeWindow: async () => {},
  onOpenSettings: () => () => {},
  onSettingsChanged: () => () => {},
  onWindowModeChanged: () => () => {},
};

function App() {
  const isSettingsWindow = new URLSearchParams(window.location.search).get('window') === 'settings';

  if (isSettingsWindow) {
    return <SettingsWindow />;
  }

  return <DashboardWindow />;
}

function DashboardWindow() {
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [quote, setQuote] = useState(null);
  const [error, setError] = useState('');
  const [compact, setCompact] = useState(false);
  const alertTriggeredRef = useRef(false);
  const compactDragRef = useRef({ isDragging: false, didMove: false, startX: 0, startY: 0 });

  const formatted = useMemo(() => (quote ? formatQuote(quote) : null), [quote]);
  const surfaceStyle = useMemo(() => {
    const { r, g, b } = hexToRgb(settings.backgroundColor);
    return {
      '--panel-bg': `rgba(${r}, ${g}, ${b}, ${settings.opacity / 100})`,
      '--trend-color': formatted?.trendColor ?? '#a3a3a3',
    };
  }, [settings.backgroundColor, settings.opacity, formatted?.trendColor]);

  const fetchQuote = useCallback(async () => {
    try {
      const nextQuote = await bridge.fetchGoldQuote(settings.source);
      setQuote(nextQuote);
      setError('');

      const alertPrice = Number(settings.alertPrice);
      if (Number.isFinite(alertPrice) && nextQuote.price < alertPrice) {
        alertTriggeredRef.current = false;
      }

      if (shouldTriggerAlert({
        price: nextQuote.price,
        alertPrice,
        wasTriggered: alertTriggeredRef.current,
      })) {
        alertTriggeredRef.current = true;
        bridge.shakeWindow();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '金价刷新失败');
    }
  }, [settings.alertPrice, settings.source]);

  useEffect(() => {
    fetchQuote();
    const timer = window.setInterval(fetchQuote, PRICE_REFRESH_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [fetchQuote]);

  useEffect(() => {
    const removeModeChanged = bridge.onWindowModeChanged((mode) => setCompact(mode === 'compact'));
    const removeSettingsChanged = bridge.onSettingsChanged((nextSettings) => {
      setSettings(normalizeSettings(nextSettings));
    });
    bridge.getSettings().then((nextSettings) => {
      setSettings(normalizeSettings(nextSettings));
    });
    return () => {
      removeModeChanged();
      removeSettingsChanged();
    };
  }, []);

  useEffect(() => {
    const handleKeydown = (event) => {
      if (event.key.toLowerCase() === 's' && !isFormField(event.target)) {
        event.preventDefault();
        openSettings();
      }
    };

    window.addEventListener('keydown', handleKeydown);
    return () => window.removeEventListener('keydown', handleKeydown);
  }, []);

  function openSettings() {
    bridge.openSettingsWindow();
  }

  async function enterCompactMode() {
    setCompact(true);
    await bridge.setWindowMode('compact');
  }

  async function restoreNormalMode() {
    setCompact(false);
    await bridge.setWindowMode('normal');
  }

  function startCompactDrag(event) {
    if (event.button !== 0) {
      return;
    }

    compactDragRef.current = {
      isDragging: true,
      didMove: false,
      startX: event.screenX,
      startY: event.screenY,
    };
    event.currentTarget.setPointerCapture?.(event.pointerId);
    bridge.startWindowDrag({ x: event.screenX, y: event.screenY });
  }

  function moveCompactDrag(event) {
    if (!compactDragRef.current.isDragging) {
      return;
    }

    const dx = Math.abs(event.screenX - compactDragRef.current.startX);
    const dy = Math.abs(event.screenY - compactDragRef.current.startY);
    compactDragRef.current.didMove = compactDragRef.current.didMove || dx > 3 || dy > 3;
    bridge.moveWindowDrag({ x: event.screenX, y: event.screenY });
  }

  function endCompactDrag() {
    if (!compactDragRef.current.isDragging) {
      return;
    }

    compactDragRef.current.isDragging = false;
    bridge.endWindowDrag();
  }

  function handleCompactClick() {
    if (compactDragRef.current.didMove) {
      compactDragRef.current.didMove = false;
      return;
    }

    restoreNormalMode();
  }

  if (compact) {
    return (
      <main
        className="panel compact"
        style={surfaceStyle}
        onClick={handleCompactClick}
        onPointerDown={startCompactDrag}
        onPointerMove={moveCompactDrag}
        onPointerUp={endCompactDrag}
        onPointerCancel={endCompactDrag}
        onLostPointerCapture={endCompactDrag}
        title="拖拽移动，点击恢复正常窗口"
      >
        <span className="compact-price">{formatted?.priceText.replace(' 元/克', '') ?? '--'}</span>
      </main>
    );
  }

  return (
    <main className="panel normal" style={surfaceStyle}>
      <Dashboard
        quote={quote}
        formatted={formatted}
        error={error}
        alertPrice={settings.alertPrice}
        onCompact={enterCompactMode}
      />
    </main>
  );
}

function SettingsWindow() {
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);

  useEffect(() => {
    bridge.getSettings().then((nextSettings) => {
      setSettings(normalizeSettings(nextSettings));
    });

    return bridge.onSettingsChanged((nextSettings) => {
      setSettings(normalizeSettings(nextSettings));
    });
  }, []);

  async function updateSetting(key, value) {
    const nextSettings = normalizeSettings({ ...settings, [key]: value });
    setSettings(nextSettings);
    const syncedSettings = await bridge.updateSettings(nextSettings);
    setSettings(normalizeSettings(syncedSettings));
  }

  return (
    <main className="settings-window">
      <SettingsPanel
        settings={settings}
        onChange={updateSetting}
        onCompact={() => bridge.setWindowMode('compact')}
        onNormal={() => bridge.setWindowMode('normal')}
        onQuit={() => bridge.quitApp()}
      />
    </main>
  );
}

function Dashboard({ quote, formatted, error, alertPrice, onCompact }) {
  return (
    <section className="dashboard" onDoubleClick={onCompact}>
      <div className="price-line" style={{ color: formatted?.trendColor }}>
        {formatted?.priceText ?? '-- 元/克'}
      </div>
      <div className="baseline-line" style={{ color: formatted?.trendColor }}>
        {formatted?.baselineText ?? '基准：-- — 0.00 0.00%'}
      </div>
      <div className="meta-line">
        更新时间：{quote?.updatedAt ?? '--'} · API：{quote?.sourceLabel ?? '--'}
      </div>
      <div className="hint-line">
        预警价：{alertPrice ? `${Number(alertPrice).toFixed(2)} 元` : '未设置'} · S 设置 · M 小窗 · Ctrl/⌘+Q 退出
      </div>
      {error && <div className="error-line">{error}</div>}
    </section>
  );
}

function SettingsPanel({ settings, onChange, onCompact, onNormal, onQuit }) {
  return (
    <section className="settings-panel">
      <header className="settings-header">
        <h1>设置</h1>
      </header>

      <label className="field">
        <span>API 源</span>
        <select value={settings.source} onChange={(event) => onChange('source', event.target.value)}>
          <option value="zheshang">浙商银行</option>
          <option value="sina">新浪</option>
        </select>
      </label>

      <label className="field">
        <span>背景颜色</span>
        <div className="color-row">
          <input
            type="color"
            value={settings.backgroundColor}
            onChange={(event) => onChange('backgroundColor', event.target.value)}
          />
          <input
            type="text"
            value={settings.backgroundColor}
            onChange={(event) => onChange('backgroundColor', normalizeColorInput(event.target.value))}
            maxLength={7}
          />
        </div>
      </label>

      <label className="field">
        <span>透明度：{settings.opacity}%</span>
        <input
          type="range"
          min="0"
          max="100"
          value={settings.opacity}
          onChange={(event) => onChange('opacity', Number(event.target.value))}
        />
      </label>

      <label className="field">
        <span>预警价格（元/克）</span>
        <input
          type="number"
          min="0"
          step="0.01"
          placeholder="例如 1000.00"
          value={settings.alertPrice}
          onChange={(event) => onChange('alertPrice', event.target.value)}
        />
      </label>

      <div className="settings-actions">
        <button type="button" onClick={onCompact}>小窗模式</button>
        <button type="button" onClick={onNormal}>正常窗口</button>
        <button type="button" className="danger-button" onClick={onQuit}>退出应用</button>
      </div>
    </section>
  );
}

function hexToRgb(hex) {
  const normalized = normalizeColorInput(hex).replace('#', '');
  const value = Number.parseInt(normalized, 16);
  return {
    r: (value >> 16) & 255,
    g: (value >> 8) & 255,
    b: value & 255,
  };
}

function normalizeColorInput(value) {
  if (/^#[0-9a-fA-F]{6}$/.test(value)) {
    return value;
  }

  return DEFAULT_SETTINGS.backgroundColor;
}

function isFormField(target) {
  return ['INPUT', 'SELECT', 'TEXTAREA'].includes(target?.tagName);
}

window.addEventListener('error', (event) => {
  bridge.logRendererError({
    type: 'error',
    message: event.message,
    stack: event.error?.stack,
    filename: event.filename,
    lineno: event.lineno,
    colno: event.colno,
  });
});

window.addEventListener('unhandledrejection', (event) => {
  const reason = event.reason;
  bridge.logRendererError({
    type: 'unhandledrejection',
    message: reason instanceof Error ? reason.message : String(reason),
    stack: reason instanceof Error ? reason.stack : undefined,
  });
});

createRoot(document.getElementById('root')).render(<App />);
