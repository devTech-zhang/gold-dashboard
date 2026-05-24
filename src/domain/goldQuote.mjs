const SOURCE_LABELS = {
  zheshang: '浙商银行',
  sina: '新浪',
};

const TREND_STYLES = {
  up: { marker: '▲', trendColor: '#ff4d4f' },
  down: { marker: '▼', trendColor: '#16a34a' },
  flat: { marker: '—', trendColor: '#a3a3a3' },
};

const BEIJING_TIME_FORMATTER = new Intl.DateTimeFormat('zh-CN', {
  timeZone: 'Asia/Shanghai',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});

export function parseZheshangQuote(text) {
  const price = readNumber(text, /最新价格\s*[:：]\s*([+-]?\d+(?:\.\d+)?)/);
  const change = readNumber(text, /涨跌额\s*[:：]\s*([+-]?\d+(?:\.\d+)?)/);
  const changePercent = readNumber(text, /涨跌幅\s*[:：]\s*([+-]?\d+(?:\.\d+)?)\s*%?/);
  const previousClose = readNumber(text, /前收盘价\s*[:：]\s*([+-]?\d+(?:\.\d+)?)/);
  const updatedAt = readText(text, /更新时间\s*[:：]\s*([^\r\n]+)/) ?? new Date().toLocaleString('zh-CN');
  const baseline = Number.isFinite(previousClose) ? previousClose : round(price - (change || 0));

  if (!Number.isFinite(price)) {
    throw new Error('无法解析浙商银行金价');
  }

  return {
    source: 'zheshang',
    sourceLabel: SOURCE_LABELS.zheshang,
    price,
    baseline,
    change: Number.isFinite(change) ? change : round(price - baseline),
    changePercent: Number.isFinite(changePercent) ? changePercent : percent(price, baseline),
    updatedAt,
  };
}

export function parseSinaQuote(text) {
  const quoted = text.match(/="([^"]*)"/)?.[1] ?? text;
  const parts = quoted.split(',').map((part) => part.trim()).filter(Boolean);
  const isSgeAu9999 = parts[0] === 'AU9999' || parts[0] === 'SGE_AU9999';

  if (isSgeAu9999) {
    const price = Number(parts[3]);
    const baseline = Number(parts[9]) || price;
    const changePercent = Number(String(parts.at(-1)).replace('%', ''));

    if (!Number.isFinite(price)) {
      throw new Error('无法解析新浪金价');
    }

    return {
      source: 'sina',
      sourceLabel: SOURCE_LABELS.sina,
      price,
      baseline,
      change: round(price - baseline),
      changePercent: Number.isFinite(changePercent) ? changePercent : percent(price, baseline),
      updatedAt: parts[16] || new Date().toLocaleString('zh-CN'),
    };
  }

  const numericParts = parts.map((part) => Number(part)).filter(Number.isFinite);

  const price = Number(parts[4]) || numericParts.at(0);
  const baseline = Number(parts[1]) || numericParts.at(1) || price;
  const date = parts.find((part) => /^\d{4}-\d{2}-\d{2}$/.test(part));
  const time = parts.find((part) => /^\d{1,2}:\d{2}:\d{2}$/.test(part));

  if (!Number.isFinite(price)) {
    throw new Error('无法解析新浪金价');
  }

  return {
    source: 'sina',
    sourceLabel: SOURCE_LABELS.sina,
    price,
    baseline,
    change: round(price - baseline),
    changePercent: percent(price, baseline),
    updatedAt: [date, time].filter(Boolean).join(' ') || new Date().toLocaleString('zh-CN'),
  };
}

export function formatQuote(quote) {
  const price = round(quote.price);
  const baseline = round(quote.baseline ?? quote.price);
  const change = round(quote.change ?? price - baseline);
  const changePercent = round(quote.changePercent ?? percent(price, baseline));
  const trend = change > 0 ? 'up' : change < 0 ? 'down' : 'flat';
  const style = TREND_STYLES[trend];
  const signedChange = change > 0 ? `+${change.toFixed(2)}` : change.toFixed(2);
  const signedPercent = changePercent > 0 ? `+${changePercent.toFixed(2)}%` : `${changePercent.toFixed(2)}%`;

  return {
    priceText: `${price.toFixed(2)} 元/克`,
    baselineText: `基准：${baseline.toFixed(2)} ${style.marker} ${signedChange} ${signedPercent}`,
    trend,
    marker: style.marker,
    trendColor: style.trendColor,
  };
}

export function shouldTriggerAlert({ price, alertPrice, wasTriggered }) {
  const threshold = Number(alertPrice);
  return Number.isFinite(threshold) && threshold > 0 && price >= threshold && !wasTriggered;
}

export function formatBeijingTimestamp(date = new Date()) {
  const parts = Object.fromEntries(
    BEIJING_TIME_FORMATTER.formatToParts(date)
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, part.value]),
  );

  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second}`;
}

function readNumber(text, pattern) {
  const value = text.match(pattern)?.[1];
  return value == null ? Number.NaN : Number(value);
}

function readText(text, pattern) {
  return text.match(pattern)?.[1]?.trim();
}

function percent(price, baseline) {
  if (!Number.isFinite(price) || !Number.isFinite(baseline) || baseline === 0) {
    return 0;
  }

  return round(((price - baseline) / baseline) * 100);
}

function round(value) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}
