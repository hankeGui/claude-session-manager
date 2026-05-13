import express from 'express';
import path from 'path';
import fs from 'fs';
import projectsRouter from './src/routes/projects';
import sessionsRouter from './src/routes/sessions';
import searchRouter from './src/routes/search';
import schedulerRouter from './src/routes/scheduler';
import settingsRouter from './src/routes/settings';
import * as scanner from './src/services/scanner';
import * as scheduler from './src/services/scheduler';
import * as aiScanner from './src/services/ai-scanner';

const app = express();
const PORT = process.env.PORT || 3000;
const PKG_VERSION = require('./package.json').version;

app.use(express.json());

const staticDir = path.join(__dirname, 'dist');
if (fs.existsSync(staticDir)) {
  app.use(express.static(staticDir));
}

app.use('/api/projects', projectsRouter);
app.use('/api/sessions', sessionsRouter);
app.use('/api/search', searchRouter);
app.use('/api/scheduler', schedulerRouter);
app.use('/api/settings', settingsRouter);

app.get('/api/ai-scan/status', (_req, res) => {
  res.json(aiScanner.getStatus());
});

app.post('/api/ai-scan/pause', (_req, res) => {
  aiScanner.pause();
  res.json({ success: true });
});

app.post('/api/ai-scan/resume', (_req, res) => {
  aiScanner.resume();
  res.json({ success: true });
});

app.post('/api/ai-scan/stop', (_req, res) => {
  aiScanner.stop();
  res.json({ success: true });
});

app.post('/api/rescan', async (_req, res) => {
  await scanner.scan();
  const data = scanner.getData();
  const pending = aiScanner.getQueueSize();
  res.json({
    success: true,
    projects: data.projects.length,
    sessions: data.projects.reduce((sum, p) => sum + p.sessions.length, 0),
    pending,
  });
});

app.post('/api/ai-scan/start', (_req, res) => {
  aiScanner.start();
  res.json({ success: true });
});

app.post('/api/rescan/force', async (_req, res) => {
  scanner.clearTitles();
  scanner.clearTags();
  aiScanner.clearSummaries();
  await scanner.scan();
  const pending = aiScanner.getQueueSize();
  aiScanner.start();
  res.json({ success: true, pending });
});

app.post('/api/clear-cache', (_req, res) => {
  scanner.clearTitles();
  scanner.clearTags();
  aiScanner.clearSummaries();
  res.json({ success: true, cleared: ['titles', 'tags', 'summaries'] });
});

app.get('/api/stats', (_req, res) => {
  const data = scanner.getData();
  const allSessions = data.projects.flatMap(p => p.sessions);
  const emptySessions = allSessions.filter(s => s.isEmpty);
  res.json({
    totalProjects: data.projects.length,
    totalSessions: allSessions.length,
    emptySessions: emptySessions.length,
    oldestSession: allSessions.length ? allSessions.reduce((a, b) => a.created < b.created ? a : b).created : null,
    newestSession: allSessions.length ? allSessions.reduce((a, b) => a.modified > b.modified ? a : b).modified : null,
    version: PKG_VERSION,
  });
});

app.get('/api/check-update', async (_req, res) => {
  try {
    const resp = await fetch('https://registry.npmjs.org/claude-session-mgr/latest');
    const data = await resp.json();
    res.json({ current: PKG_VERSION, latest: data.version, hasUpdate: data.version !== PKG_VERSION });
  } catch {
    res.status(500).json({ error: 'Failed to check for updates' });
  }
});

// SPA fallback
app.get('*', (_req, res) => {
  const indexFile = path.join(staticDir, 'index.html');
  if (fs.existsSync(indexFile)) {
    res.sendFile(indexFile);
  } else {
    res.status(404).send('Frontend not built. Run: npm run build');
  }
});

async function start() {
  console.log('Scanning sessions...');
  await scanner.scan();
  const data = scanner.getData();
  console.log(`Found ${data.projects.length} projects with ${data.projects.reduce((sum, p) => sum + p.sessions.length, 0)} sessions`);

  scheduler.init();
  console.log('Scheduler initialized');

  // Background AI scan — fire and forget
  aiScanner.start();

  app.listen(PORT, () => {
    console.log(`Claude Session Manager v${PKG_VERSION} running at http://localhost:${PORT}`);
  });
}

start().catch(err => {
  console.error('Failed to start:', err);
  process.exit(1);
});
