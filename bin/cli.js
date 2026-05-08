#!/usr/bin/env node

const { execSync, spawn } = require('child_process');
const path = require('path');

const PORT = process.env.PORT || 3000;
process.env.PORT = String(PORT);

// Check if claude CLI is available
try {
  execSync('which claude', { stdio: 'ignore' });
} catch {
  console.warn('Warning: Claude Code CLI not found. AI features (auto-rename, deep search) will not work.');
  console.warn('Install it from: https://docs.anthropic.com/en/docs/claude-code\n');
}

// Auto-open browser after server starts (unless --no-open flag)
const noOpen = process.argv.includes('--no-open');

if (!noOpen) {
  setTimeout(() => {
    const url = `http://localhost:${PORT}`;
    try {
      if (process.platform === 'darwin') {
        execSync(`open "${url}"`, { stdio: 'ignore' });
      } else if (process.platform === 'win32') {
        execSync(`start "${url}"`, { stdio: 'ignore' });
      } else {
        execSync(`xdg-open "${url}"`, { stdio: 'ignore' });
      }
    } catch {}
  }, 2000);
}

// Start the server via tsx (bundled as dependency)
const fs = require('fs');
const possibleTsxPaths = [
  path.join(__dirname, '..', 'node_modules', '.bin', 'tsx'),  // nested node_modules
  path.join(__dirname, '..', '..', '.bin', 'tsx'),             // hoisted (npx/flat)
];
const tsxBin = possibleTsxPaths.find(p => fs.existsSync(p));
if (!tsxBin) {
  console.error('Error: tsx not found. Try reinstalling: npm install -g claude-session-mgr');
  process.exit(1);
}
const serverPath = path.join(__dirname, '..', 'server.ts');

const child = spawn(tsxBin, [serverPath], {
  stdio: 'inherit',
  env: { ...process.env, PORT: String(PORT) },
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
