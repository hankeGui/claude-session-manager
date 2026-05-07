#!/usr/bin/env tsx

import { execSync } from 'child_process';
import path from 'path';

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
    } catch {
      // Silently fail if browser can't be opened
    }
  }, 1500);
}

// Start the server
import(path.join(__dirname, '..', 'server.ts'));
