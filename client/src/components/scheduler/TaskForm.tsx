import { useState, useEffect } from 'react';
import { useSchedulerStore } from '../../store/scheduler';
import { schedulerApi } from '../../api/scheduler';

const CRON_PRESETS = [
  { label: 'Every minute', cron: '* * * * *' },
  { label: 'Every 5 min', cron: '*/5 * * * *' },
  { label: 'Every 15 min', cron: '*/15 * * * *' },
  { label: 'Every hour', cron: '0 * * * *' },
  { label: 'Every 2h', cron: '0 */2 * * *' },
  { label: 'Daily 9:00', cron: '0 9 * * *' },
  { label: 'Daily 18:00', cron: '0 18 * * *' },
  { label: 'Weekdays 9:00', cron: '0 9 * * 1-5' },
  { label: 'Mon 9:00', cron: '0 9 * * 1' },
  { label: 'Monthly 1st', cron: '0 9 1 * *' },
];

// Parse natural language to cron
function nlToCron(text: string): string | null {
  const t = text.toLowerCase().trim();
  if (!t) return null;

  // "every X minutes"
  let m = t.match(/every\s+(\d+)\s*min/);
  if (m) return `*/${m[1]} * * * *`;

  // "every minute"
  if (/every\s*min/.test(t)) return '* * * * *';

  // "every X hours"
  m = t.match(/every\s+(\d+)\s*h/);
  if (m) return `0 */${m[1]} * * *`;

  // "every hour"
  if (/every\s*hour/.test(t)) return '0 * * * *';

  // "every day at HH:MM" or "daily at HH:MM" or "每天 HH:MM"
  m = t.match(/(?:every\s*day|daily|每天)\s*(?:at\s*)?(\d{1,2}):?(\d{2})?/);
  if (m) return `${m[2] || '0'} ${m[1]} * * *`;

  // "weekdays at HH:MM" or "工作日 HH:MM"
  m = t.match(/(?:weekday|工作日)\s*(?:at\s*)?(\d{1,2}):?(\d{2})?/);
  if (m) return `${m[2] || '0'} ${m[1]} * * 1-5`;

  // "every monday/tuesday..." + optional time
  const dayMap: Record<string, string> = {
    'sun': '0', 'sunday': '0', '周日': '0', '星期日': '0',
    'mon': '1', 'monday': '1', '周一': '1', '星期一': '1',
    'tue': '2', 'tuesday': '2', '周二': '2', '星期二': '2',
    'wed': '3', 'wednesday': '3', '周三': '3', '星期三': '3',
    'thu': '4', 'thursday': '4', '周四': '4', '星期四': '4',
    'fri': '5', 'friday': '5', '周五': '5', '星期五': '5',
    'sat': '6', 'saturday': '6', '周六': '6', '星期六': '6',
  };
  for (const [key, val] of Object.entries(dayMap)) {
    const re = new RegExp(`(?:every\\s*)?${key}\\s*(?:at\\s*)?(\\d{1,2})?:?(\\d{2})?`);
    const dm = t.match(re);
    if (dm) return `${dm[2] || '0'} ${dm[1] || '9'} * * ${val}`;
  }

  // "每X分钟"
  m = t.match(/每\s*(\d+)\s*分/);
  if (m) return `*/${m[1]} * * * *`;

  // "每X小时"
  m = t.match(/每\s*(\d+)\s*小时/);
  if (m) return `0 */${m[1]} * * *`;

  // "每小时"
  if (/每小时/.test(t)) return '0 * * * *';

  // "每月X号 HH:MM"
  m = t.match(/每月\s*(\d+)\s*[号日]\s*(\d{1,2})?:?(\d{2})?/);
  if (m) return `${m[3] || '0'} ${m[2] || '9'} ${m[1]} * *`;

  return null;
}

function describeCron(expr: string): string {
  if (!expr) return '';
  const parts = expr.split(' ');
  if (parts.length !== 5) return 'Invalid';

  const [min, hour, dom, mon, dow] = parts;

  if (expr === '* * * * *') return 'Every minute';
  if (min.startsWith('*/') && hour === '*' && dom === '*' && mon === '*' && dow === '*') {
    return `Every ${min.slice(2)} minutes`;
  }
  if (min === '0' && hour.startsWith('*/') && dom === '*' && mon === '*' && dow === '*') {
    return `Every ${hour.slice(2)} hours`;
  }
  if (min === '0' && hour === '*' && dom === '*' && mon === '*' && dow === '*') {
    return 'Every hour';
  }
  if (dom === '*' && mon === '*' && dow === '*') {
    return `Daily at ${hour}:${min.padStart(2, '0')}`;
  }
  if (dom === '*' && mon === '*' && dow === '1-5') {
    return `Weekdays at ${hour}:${min.padStart(2, '0')}`;
  }
  if (dom === '*' && mon === '*' && dow !== '*') {
    const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const dayName = days[parseInt(dow)] || dow;
    return `Every ${dayName} at ${hour}:${min.padStart(2, '0')}`;
  }
  if (mon === '*' && dow === '*' && dom !== '*') {
    return `Monthly on day ${dom} at ${hour}:${min.padStart(2, '0')}`;
  }
  return `${min} ${hour} ${dom} ${mon} ${dow}`;
}

function getNextRuns(cronExpr: string, count = 3): string[] {
  const parts = cronExpr.split(' ');
  if (parts.length !== 5) return [];

  const [minP, hourP, domP, monP, dowP] = parts;
  const now = new Date();
  const results: string[] = [];

  // Simple next-run calculator for common patterns
  for (let offset = 0; offset < 60 * 24 * 35 && results.length < count; offset++) {
    const candidate = new Date(now.getTime() + offset * 60000);
    const m = candidate.getMinutes();
    const h = candidate.getHours();
    const d = candidate.getDate();
    const mo = candidate.getMonth() + 1;
    const dw = candidate.getDay();

    if (!matchField(minP, m)) continue;
    if (!matchField(hourP, h)) continue;
    if (!matchField(domP, d)) continue;
    if (!matchField(monP, mo)) continue;
    if (!matchDow(dowP, dw)) continue;

    // Skip current minute
    if (offset === 0) continue;

    results.push(candidate.toLocaleString());
  }
  return results;
}

function matchField(pattern: string, value: number): boolean {
  if (pattern === '*') return true;
  if (pattern.startsWith('*/')) {
    const step = parseInt(pattern.slice(2));
    return value % step === 0;
  }
  if (pattern.includes(',')) {
    return pattern.split(',').some(p => parseInt(p) === value);
  }
  if (pattern.includes('-')) {
    const [lo, hi] = pattern.split('-').map(Number);
    return value >= lo && value <= hi;
  }
  return parseInt(pattern) === value;
}

function matchDow(pattern: string, value: number): boolean {
  if (pattern === '*') return true;
  if (pattern.includes('-')) {
    const [lo, hi] = pattern.split('-').map(Number);
    return value >= lo && value <= hi;
  }
  if (pattern.includes(',')) {
    return pattern.split(',').some(p => parseInt(p) === value);
  }
  return parseInt(pattern) === value;
}

export default function TaskForm() {
  const { editingTask, createTask, updateTask, setShowForm } = useSchedulerStore();

  const [prompt, setPrompt] = useState('');
  const [scheduleType, setScheduleType] = useState<'immediate' | 'once' | 'cron'>('immediate');
  const [scheduledAt, setScheduledAt] = useState('');
  const [cronExpr, setCronExpr] = useState('');
  const [cronNl, setCronNl] = useState('');
  const [cronNlError, setCronNlError] = useState('');
  const [cronGenerating, setCronGenerating] = useState(false);
  const [cronValid, setCronValid] = useState<boolean | null>(null);
  const [skipPermissions, setSkipPermissions] = useState(true);
  const [openInTerminal, setOpenInTerminal] = useState(false);
  const [workingDirectory, setWorkingDirectory] = useState('');
  const [model, setModel] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (editingTask) {
      setPrompt(editingTask.prompt);
      setScheduleType(editingTask.scheduleType);
      setScheduledAt(editingTask.scheduledAt ? editingTask.scheduledAt.slice(0, 16) : '');
      setCronExpr(editingTask.cron || '');
      setSkipPermissions(editingTask.skipPermissions);
      setOpenInTerminal(editingTask.openInTerminal || false);
      setWorkingDirectory(editingTask.workingDirectory || '');
      setModel(editingTask.model || '');
    }
  }, [editingTask]);

  // Validate cron on change
  useEffect(() => {
    if (!cronExpr || scheduleType !== 'cron') {
      setCronValid(null);
      return;
    }
    const timer = setTimeout(async () => {
      try {
        const { valid } = await schedulerApi.validateCron(cronExpr);
        setCronValid(valid);
      } catch {
        setCronValid(false);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [cronExpr, scheduleType]);

  const handleGenerateCron = async () => {
    if (!cronNl.trim()) {
      setCronNlError('Please enter a schedule description');
      return;
    }
    // Try local parsing first
    const local = nlToCron(cronNl);
    if (local) {
      setCronExpr(local);
      setCronNlError('');
      return;
    }
    // Fallback to AI
    setCronGenerating(true);
    setCronNlError('');
    try {
      const { cron, valid } = await schedulerApi.generateCron(cronNl);
      setCronExpr(cron);
      if (!valid) setCronNlError('AI generated an expression but it may be invalid');
    } catch (err: any) {
      setCronNlError(err.message || 'AI generation failed');
    } finally {
      setCronGenerating(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!prompt.trim()) return;
    if (scheduleType === 'cron' && !cronValid) return;

    setSubmitting(true);
    const payload = {
      prompt: prompt.trim(),
      scheduleType,
      scheduledAt: scheduleType === 'once' && scheduledAt ? new Date(scheduledAt).toISOString() : null,
      cron: scheduleType === 'cron' ? cronExpr : null,
      skipPermissions,
      openInTerminal,
      workingDirectory: workingDirectory.trim() || null,
      model: model || null,
    };

    try {
      if (editingTask) {
        await updateTask(editingTask.id, payload);
      } else {
        await createTask(payload);
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="border border-border rounded-md bg-bg-secondary p-4 mb-5">
      <h3 className="text-sm font-semibold mb-3">
        {editingTask ? 'Edit Task' : 'New Task'}
      </h3>

      {/* Prompt */}
      <div className="mb-3">
        <label className="block text-[11px] text-text-muted mb-1">Prompt *</label>
        <textarea
          value={prompt}
          onChange={e => setPrompt(e.target.value)}
          rows={3}
          placeholder="Enter the task/instruction for Claude..."
          className="w-full bg-bg-card border border-border rounded px-3 py-2 text-sm text-text-primary placeholder:text-text-muted/50 resize-y focus:outline-none focus:border-accent"
        />
      </div>

      {/* Schedule Type */}
      <div className="mb-3">
        <label className="block text-[11px] text-text-muted mb-1">Schedule</label>
        <div className="flex gap-4 items-center">
          <RadioOption label="Immediately" checked={scheduleType === 'immediate'} onChange={() => setScheduleType('immediate')} />
          <RadioOption label="Once at time" checked={scheduleType === 'once'} onChange={() => setScheduleType('once')} />
          <RadioOption label="Recurring (Cron)" checked={scheduleType === 'cron'} onChange={() => setScheduleType('cron')} />
        </div>
      </div>

      {/* Once: datetime picker */}
      {scheduleType === 'once' && (
        <div className="mb-3">
          <input
            type="datetime-local"
            value={scheduledAt}
            onChange={e => setScheduledAt(e.target.value)}
            className="bg-bg-card border border-border rounded px-3 py-1.5 text-xs text-text-primary focus:outline-none focus:border-accent"
          />
        </div>
      )}

      {/* Cron: natural language + expression + presets */}
      {scheduleType === 'cron' && (
        <div className="mb-3">
          {/* Natural language input */}
          <div className="flex gap-2 mb-2">
            <input
              type="text"
              value={cronNl}
              onChange={e => { setCronNl(e.target.value); setCronNlError(''); }}
              placeholder="e.g. every 5 minutes, weekdays 9:00, 每天18:00..."
              className="flex-1 bg-bg-card border border-border rounded px-3 py-1.5 text-xs text-text-primary placeholder:text-text-muted/50 focus:outline-none focus:border-accent"
              onKeyDown={e => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  handleGenerateCron();
                }
              }}
            />
            <button
              type="button"
              disabled={cronGenerating}
              onClick={handleGenerateCron}
              className="px-3 py-1.5 bg-accent/15 text-accent text-[11px] font-medium rounded border border-accent/30 hover:bg-accent/25 disabled:opacity-50"
            >
              {cronGenerating ? 'AI Generating...' : 'Generate'}
            </button>
          </div>
          {cronNlError && (
            <p className="text-[11px] text-red-400 mb-2">{cronNlError}</p>
          )}
          {/* Cron expression */}
          <div className="flex items-center gap-2 mb-2">
            <input
              type="text"
              value={cronExpr}
              onChange={e => setCronExpr(e.target.value)}
              placeholder="* * * * * (min hour dom month dow)"
              className={`flex-1 bg-bg-card border rounded px-3 py-1.5 text-xs font-mono text-text-primary placeholder:text-text-muted/50 focus:outline-none ${
                cronValid === false ? 'border-red-500' : cronValid === true ? 'border-green-500' : 'border-border'
              }`}
            />
            {cronValid === true && cronExpr && (
              <span className="text-[11px] text-green-400 whitespace-nowrap">{describeCron(cronExpr)}</span>
            )}
            {cronValid === false && (
              <span className="text-[11px] text-red-400">Invalid</span>
            )}
          </div>
          {/* Presets */}
          <div className="flex flex-wrap gap-1.5 mb-2">
            {CRON_PRESETS.map(p => (
              <button
                key={p.cron}
                type="button"
                onClick={() => setCronExpr(p.cron)}
                className={`px-2 py-0.5 text-[10px] rounded border transition-colors ${
                  cronExpr === p.cron
                    ? 'border-accent bg-accent/15 text-accent'
                    : 'border-border text-text-muted hover:text-text-primary hover:border-text-muted'
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>
          {/* Next run times */}
          {cronValid && cronExpr && (
            <div className="text-[10px] text-text-muted">
              <span className="font-medium">Next runs: </span>
              {getNextRuns(cronExpr).join(' → ') || 'calculating...'}
            </div>
          )}
        </div>
      )}

      {/* Options row */}
      <div className="flex gap-4 mb-4">
        <div className="flex-1">
          <label className="block text-[11px] text-text-muted mb-1">Model</label>
          <select
            value={model}
            onChange={e => setModel(e.target.value)}
            className="w-full bg-bg-card border border-border rounded px-2 py-1.5 text-xs text-text-primary focus:outline-none focus:border-accent"
          >
            <option value="">Default</option>
            <option value="opus">Opus</option>
            <option value="sonnet">Sonnet</option>
            <option value="haiku">Haiku</option>
          </select>
        </div>
        <div className="flex-1">
          <label className="block text-[11px] text-text-muted mb-1">Working Directory</label>
          <input
            type="text"
            value={workingDirectory}
            onChange={e => setWorkingDirectory(e.target.value)}
            placeholder="/path/to/project"
            className="w-full bg-bg-card border border-border rounded px-2 py-1.5 text-xs text-text-primary placeholder:text-text-muted/50 focus:outline-none focus:border-accent"
          />
        </div>
        <div className="flex items-end pb-1 gap-4">
          <label className="flex items-center gap-1.5 text-xs cursor-pointer whitespace-nowrap">
            <input
              type="checkbox"
              checked={skipPermissions}
              onChange={e => setSkipPermissions(e.target.checked)}
              className="accent-accent"
            />
            Skip Permissions
          </label>
          <label className="flex items-center gap-1.5 text-xs cursor-pointer whitespace-nowrap">
            <input
              type="checkbox"
              checked={openInTerminal}
              onChange={e => setOpenInTerminal(e.target.checked)}
              className="accent-accent"
            />
            Open in Terminal
          </label>
        </div>
      </div>

      {/* Actions */}
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={!prompt.trim() || submitting || (scheduleType === 'cron' && !cronValid)}
          className="px-4 py-2 bg-accent text-white text-xs font-medium rounded-md hover:bg-accent/80 disabled:opacity-50"
        >
          {submitting ? 'Saving...' : editingTask ? 'Update' : scheduleType === 'immediate' ? 'Run Now' : 'Create'}
        </button>
        <button
          type="button"
          onClick={() => setShowForm(false)}
          className="px-4 py-2 border border-border text-text-muted text-xs rounded-md hover:text-text-primary"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

function RadioOption({ label, checked, onChange }: { label: string; checked: boolean; onChange: () => void }) {
  return (
    <label className="flex items-center gap-1.5 text-xs cursor-pointer">
      <input type="radio" name="scheduleType" checked={checked} onChange={onChange} className="accent-accent" />
      {label}
    </label>
  );
}
