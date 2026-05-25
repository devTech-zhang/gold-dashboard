import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { createFileLogger, serializeError } from '../electron/logger.mjs';

test('writes diagnostic logs to a local file', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'gold-dashboard-log-'));
  const logger = createFileLogger({
    getDirectory: () => directory,
    now: () => new Date('2026-05-25T10:00:00.000Z'),
  });

  logger.info('app starting', { electron: '22.3.27' });

  const content = fs.readFileSync(path.join(directory, 'gold-dashboard.log'), 'utf8');
  assert.match(content, /\[2026-05-25T10:00:00.000Z\] \[INFO\] app starting/);
  assert.match(content, /"electron":"22.3.27"/);
  assert.equal(logger.path, path.join(directory, 'gold-dashboard.log'));
});

test('serializes errors for file logging', () => {
  const error = new Error('startup failed');
  const serialized = serializeError(error);

  assert.equal(serialized.name, 'Error');
  assert.equal(serialized.message, 'startup failed');
  assert.match(serialized.stack, /startup failed/);
});
