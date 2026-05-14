import { Router, Request, Response } from 'express';
import * as scanner from '../services/scanner';
import type { Session } from '../types';

const router = Router();

router.get('/', (_req: Request, res: Response) => {
  const data = scanner.getData();
  const projects = data.projects.map(p => ({
    dirName: p.dirName,
    displayName: p.displayName,
    projectPath: p.projectPath,
    sessionCount: p.sessions.length,
    emptyCount: p.sessions.filter(s => s.isEmpty).length,
    totalMessages: p.sessions.reduce((sum, s) => sum + s.messageCount, 0),
    newestSession: p.sessions.length
      ? p.sessions.reduce((a, b) => (a.modified > b.modified ? a : b)).modified
      : null,
  }));
  res.json({ projects });
});

router.get('/:dirName/sessions', (req: Request, res: Response) => {
  const dirName = req.params.dirName as string;
  const { sort = 'modified', order = 'desc', empty } = req.query as {
    sort?: string; order?: string; empty?: string;
  };

  const project = scanner.getProjectByDir(dirName);
  if (!project) {
    return res.status(404).json({ error: 'Project not found' });
  }

  let sessions = [...project.sessions];

  if (empty === 'true') {
    sessions = sessions.filter(s => s.isEmpty);
  } else if (empty === 'false') {
    sessions = sessions.filter(s => !s.isEmpty);
  }

  sessions.sort((a, b) => {
    const field = sort as keyof Session;
    let cmp = 0;
    if (sort === 'modified' || sort === 'created') {
      cmp = ((a[field] as string) || '').localeCompare((b[field] as string) || '');
    } else if (sort === 'messageCount' || sort === 'diskSize') {
      cmp = ((a[field] as number) || 0) - ((b[field] as number) || 0);
    }
    return order === 'desc' ? -cmp : cmp;
  });

  res.json({ sessions, projectPath: project.projectPath, displayName: project.displayName });
});

export default router;
