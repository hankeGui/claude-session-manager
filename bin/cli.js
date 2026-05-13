#!/usr/bin/env node

const { execSync, spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const net = require('net');
const http = require('http');

// Check if claude CLI is available
try {
  execSync('which claude', { stdio: 'ignore' });
} catch {
  console.warn('Warning: Claude Code CLI not found. AI features (auto-rename, deep search) will not work.');
  console.warn('Install it from: https://docs.anthropic.com/en/docs/claude-code\n');
}

function findFreePort(startPort) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.listen(startPort, () => {
      server.close(() => resolve(startPort));
    });
    server.on('error', () => {
      resolve(findFreePort(startPort + 1));
    });
  });
}

function waitForServer(port, timeout = 30000) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    function check() {
      if (Date.now() - start > timeout) {
        return reject(new Error('Server startup timed out'));
      }
      const req = http.get(`http://localhost:${port}/api/stats`, (res) => {
        if (res.statusCode === 200) {
          resolve();
        } else {
          setTimeout(check, 300);
        }
      });
      req.on('error', () => setTimeout(check, 300));
      req.setTimeout(2000, () => { req.destroy(); setTimeout(check, 300); });
    }
    check();
  });
}

function openBrowser(url) {
  try {
    if (process.platform === 'darwin') {
      execSync(`open "${url}"`, { stdio: 'ignore' });
    } else if (process.platform === 'win32') {
      execSync(`start "${url}"`, { stdio: 'ignore' });
    } else {
      execSync(`xdg-open "${url}"`, { stdio: 'ignore' });
    }
  } catch {}
}

async function main() {
  const preferredPort = parseInt(process.env.PORT, 10) || 3000;
  const port = await findFreePort(preferredPort);

  if (port !== preferredPort) {
    console.log(`Port ${preferredPort} is in use, using ${port} instead.`);
  }

  const noOpen = process.argv.includes('--no-open');

  // Find tsx binary
  const possibleTsxPaths = [
    path.join(__dirname, '..', 'node_modules', '.bin', 'tsx'),
    path.join(__dirname, '..', '..', '.bin', 'tsx'),
  ];
  const tsxBin = possibleTsxPaths.find(p => fs.existsSync(p));
  if (!tsxBin) {
    console.error('Error: tsx not found. Try reinstalling: npm install -g claude-session-mgr');
    process.exit(1);
  }

  const serverPath = path.join(__dirname, '..', 'server.ts');
  const child = spawn(tsxBin, [serverPath], {
    stdio: 'inherit',
    env: { ...process.env, PORT: String(port) },
  });

  child.on('exit', (code) => {
    process.exit(code || 0);
  });

  process.on('SIGINT', () => {
    child.kill('SIGINT');
  });

  process.on('SIGTERM', () => {
    child.kill('SIGTERM');
  });

  // Wait for server to be ready before opening browser
  if (!noOpen) {
    waitForServer(port).then(() => {
      const url = `http://localhost:${port}`;
      console.log(`Opening browser: ${url}`);
      openBrowser(url);
    }).catch(() => {
      // Server failed to start, don't open browser
    });
  }
}

main();
