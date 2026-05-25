import test from 'node:test';
import assert from 'node:assert/strict';

import { PRICE_REFRESH_INTERVAL_MS } from '../src/domain/config.mjs';
import {
  formatBeijingTimestamp,
  formatQuote,
  parseSinaQuote,
  parseZheshangQuote,
  shouldTriggerAlert,
} from '../src/domain/goldQuote.mjs';

test('refreshes gold price every 3 seconds', () => {
  assert.equal(PRICE_REFRESH_INTERVAL_MS, 3_000);
});

test('formats refresh time as 24-hour Beijing time', () => {
  const timestamp = formatBeijingTimestamp(new Date('2026-05-23T18:30:05Z'));

  assert.equal(timestamp, '2026-05-24 02:30:05');
});

test('parses Zheshang accumulated gold text response', () => {
  const quote = parseZheshangQuote(`浙商银行积存金价格信息
产品名称: 浙商银行积存金
产品代码: JCJ
最新价格: 1010.56 元
涨跌额: 30.89 元
涨跌幅: 3.15%
前收盘价: 979.67 元
更新时间: 2026-3-25 17:49:0`);

  assert.equal(quote.source, 'zheshang');
  assert.equal(quote.sourceLabel, '浙商银行');
  assert.equal(quote.price, 1010.56);
  assert.equal(quote.baseline, 979.67);
  assert.equal(quote.change, 30.89);
  assert.equal(quote.changePercent, 3.15);
  assert.equal(quote.updatedAt, '2026-3-25 17:49:0');
});

test('parses Sina hq string response with price, baseline and timestamp', () => {
  const quote = parseSinaQuote('var hq_str_SGE_AU9999="AU9999,沪  金99,Au99.99,991.00,988.70,992.10,998.00,998.00,985.60,992.20,988.01,993.50,3.00,6.00,3776.00,3733315250.00,2026-05-24 20:00:00,-0.12%";');

  assert.equal(quote.source, 'sina');
  assert.equal(quote.sourceLabel, '新浪');
  assert.equal(quote.price, 991);
  assert.equal(quote.baseline, 992.2);
  assert.equal(quote.change, -1.2);
  assert.equal(quote.changePercent, -0.12);
  assert.equal(quote.updatedAt, '2026-05-24 20:00:00');
});

test('formats up, down and flat quote states with requested markers and colors', () => {
  assert.deepEqual(
    formatQuote({ price: 988.88, baseline: 987.77, updatedAt: 'now', sourceLabel: '浙商银行' }),
    {
      priceText: '988.88 元/克',
      baselineText: '基准：987.77 ▲ +1.11 +0.11%',
      trend: 'up',
      marker: '▲',
      trendColor: '#ff4d4f',
    },
  );

  assert.equal(formatQuote({ price: 986, baseline: 987, updatedAt: 'now', sourceLabel: '新浪' }).marker, '▼');
  assert.equal(formatQuote({ price: 987, baseline: 987, updatedAt: 'now', sourceLabel: '新浪' }).marker, '—');
});

test('triggers alert once while price stays above configured threshold', () => {
  assert.equal(shouldTriggerAlert({ price: 999, alertPrice: 1000, wasTriggered: false }), false);
  assert.equal(shouldTriggerAlert({ price: 1000, alertPrice: 1000, wasTriggered: false }), true);
  assert.equal(shouldTriggerAlert({ price: 1005, alertPrice: 1000, wasTriggered: true }), false);
});
