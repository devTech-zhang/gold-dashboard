import { spawn } from 'node:child_process';
import http from 'node:http';
import path from 'node:path';
import process from 'node:process';

const root = process.cwd();
const vite = spawn(command('npm'), ['run', 'dev'], {
  cwd: root,
  stdio: 'inherit',
  shell: process.platform === 'win32',
});

await waitForServer('http://127.0.0.1:5173');

const electronBin = path.join(root, 'node_modules', '.bin', process.platform === 'win32' ? 'electron.cmd' : 'electron');
const electron = spawn(electronBin, ['.'], {
  cwd: root,
  stdio: 'inherit',
  shell: process.platform === 'win32',
  env: {
    ...process.env,
    VITE_DEV_SERVER_URL: 'http://127.0.0.1:5173',
  },
});

electron.on('exit', (code) => {
  vite.kill();
  process.exit(code ?? 0);
});

process.on('SIGINT', () => {
  vite.kill();
  electron.kill();
});

function waitForServer(url) {
  return new Promise((resolve) => {
    const timer = setInterval(() => {
      const req = http.get(url, (res) => {
        res.resume();
        clearInterval(timer);
        resolve();
      });
      req.on('error', () => {});
      req.setTimeout(500, () => req.destroy());
    }, 250);
  });
}

function command(name) {
  return process.platform === 'win32' ? `${name}.cmd` : name;
}
