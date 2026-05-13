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
  });
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
    console.log(`Claude Session Manager running at http://localhost:${PORT}`);
  });
}

start().catch(err => {
  console.error('Failed to start:', err);
  process.exit(1);
});
