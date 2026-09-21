'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const { spawn } = require('child_process');

const REPO_ROOT = path.join(__dirname, '..', '..');

function makeWorkspace(name) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `cpd-e2e-${name}-`));
  fs.copyFileSync(path.join(REPO_ROOT, 'server.js'), path.join(dir, 'server.js'));
  fs.cpSync(path.join(REPO_ROOT, 'public'), path.join(dir, 'public'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'data'), { recursive: true });
  return dir;
}

function writeHoldings(workspaceDir, holdingsObj) {
  fs.writeFileSync(path.join(workspaceDir, 'holdings.json'), JSON.stringify(holdingsObj, null, 2));
}

function writeHoldingsRaw(workspaceDir, text) {
  fs.writeFileSync(path.join(workspaceDir, 'holdings.json'), text);
}

function httpJson(baseUrl, urlPath) {
  return new Promise((resolve, reject) => {
    const req = http.get(baseUrl + urlPath, (res) => {
      let body = '';
      res.on('data', (d) => (body += d));
      res.on('end', () => {
        let parsed = null;
        try {
          parsed = JSON.parse(body);
        } catch {
          /* leave null for non-JSON routes */
        }
        resolve({ status: res.statusCode, headers: res.headers, body, json: parsed });
      });
    });
    req.on('error', reject);
  });
}

async function waitForServer(baseUrl, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let lastErr;
  while (Date.now() < deadline) {
    try {
      const res = await httpJson(baseUrl, '/api/history');
      if (res.status === 200) return;
    } catch (e) {
      lastErr = e;
    }
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(`server did not become ready at ${baseUrl}: ${lastErr && lastErr.message}`);
}

let nextPort = 4100;
function allocatePort() {
  return nextPort++;
}

async function spawnServer(workspaceDir, envOverrides) {
  const port = allocatePort();
  const env = {
    ...process.env,
    PORT: String(port),
    DATA_DIR: path.join(workspaceDir, 'data'),
    ...envOverrides,
  };
  const proc = spawn(process.execPath, ['server.js'], {
    cwd: workspaceDir,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stderr = '';
  proc.stderr.on('data', (d) => (stderr += d));
  const baseUrl = `http://127.0.0.1:${port}`;
  await waitForServer(baseUrl, 5000);
  return {
    baseUrl,
    proc,
    getStderr: () => stderr,
    async stop() {
      proc.kill();
      await new Promise((resolve) => proc.once('exit', resolve));
    },
  };
}

function sha256(obj) {
  return crypto.createHash('sha256').update(JSON.stringify(obj)).digest('hex');
}

function cleanupWorkspace(dir) {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    /* best effort */
  }
}

module.exports = {
  REPO_ROOT,
  makeWorkspace,
  writeHoldings,
  writeHoldingsRaw,
  httpJson,
  spawnServer,
  sha256,
  cleanupWorkspace,
};
