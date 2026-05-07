const { Router } = require('express');
const scanner = require('../services/scanner');

const router = Router();

// GET /api/projects
router.get('/', (req, res) => {
  const data = scanner.getData();
  const projects = data.projects.map(p => ({
    dirName: p.dirName,
    displayName: p.displayName,
    projectPath: p.projectPath,
    sessionCount: p.sessionCount,
    emptyCount: p.sessions.filter(s => s.isEmpty).length,
    totalMessages: p.sessions.reduce((sum, s) => sum + s.messageCount, 0),
    newestSession: p.sessions.length
      ? p.sessions.reduce((a, b) => (a.modified > b.modified ? a : b)).modified
      : null,
  }));
  res.json({ projects });
});

// GET /api/projects/:dirName/sessions
router.get('/:dirName/sessions', (req, res) => {
  const { dirName } = req.params;
  const { sort = 'modified', order = 'desc', empty } = req.query;

  const project = scanner.getProjectByDir(dirName);
  if (!project) {
    return res.status(404).json({ error: 'Project not found' });
  }

  let sessions = [...project.sessions];

  // Filter
  if (empty === 'true') {
    sessions = sessions.filter(s => s.isEmpty);
  } else if (empty === 'false') {
    sessions = sessions.filter(s => !s.isEmpty);
  }

  // Sort
  sessions.sort((a, b) => {
    let cmp = 0;
    if (sort === 'modified' || sort === 'created') {
      cmp = (a[sort] || '').localeCompare(b[sort] || '');
    } else if (sort === 'messageCount' || sort === 'diskSize') {
      cmp = (a[sort] || 0) - (b[sort] || 0);
    }
    return order === 'desc' ? -cmp : cmp;
  });

  res.json({ sessions, projectPath: project.projectPath, displayName: project.displayName });
});

module.exports = router;
