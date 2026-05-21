import { useState, useEffect } from 'react';
import { api } from '../api';
import { useStore } from '../store';

export default function AiConfigDialog({ onSaved }: { onSaved?: () => void } = {}) {
  const show = useStore((s) => s.showAiConfig);
  const setShow = useStore((s) => s.setShowAiConfig);

  const [baseUrl, setBaseUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [authToken, setAuthToken] = useState('');
  const [qualityModel, setQualityModel] = useState('');
  const [fastModel, setFastModel] = useState('');
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<'idle' | 'success' | 'error' | 'loaded'>('idle');
  const [errorMsg, setErrorMsg] = useState('');
  const [maskedApiKey, setMaskedApiKey] = useState('');
  const [maskedAuthToken, setMaskedAuthToken] = useState('');

  useEffect(() => {
    if (!show) return;
    setStatus('idle');
    setErrorMsg('');
    setSaving(false);
    setLoading(false);
    setApiKey('');
    setAuthToken('');
    api.getAiSettings().then((settings) => {
      if (settings.isConfigured) {
        setBaseUrl(settings.baseUrl || '');
        setQualityModel(settings.qualityModel || '');
        setFastModel(settings.fastModel || '');
        setMaskedApiKey(settings.apiKey || '');
        setMaskedAuthToken(settings.authToken || '');
      }
    }).catch(() => {});
  }, [show]);

  if (!show) return null;

  const handleSave = async () => {
    setSaving(true);
    setStatus('idle');
    setErrorMsg('');
    try {
      const result = await api.saveAiSettings({ baseUrl, apiKey, authToken, qualityModel, fastModel });
      if (result.verified) {
        setStatus('success');
        onSaved?.();
        setTimeout(() => setShow(false), 1500);
      } else {
        setStatus('error');
        setErrorMsg(result.error || 'Connection verification failed');
      }
    } catch (err: any) {
      setStatus('error');
      setErrorMsg(err.message || 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  const handleLoadFromClaude = async () => {
    setLoading(true);
    setStatus('idle');
    setErrorMsg('');
    try {
      const config = await api.getClaudeNativeConfig();
      if (!config.found) {
        setStatus('error');
        setErrorMsg('No credentials found in ~/.claude/settings.json or environment variables');
        return;
      }
      setBaseUrl(config.baseUrl || '');
      setApiKey(config.apiKey || '');
      setAuthToken(config.authToken || '');
      setQualityModel(config.qualityModel || '');
      setFastModel(config.fastModel || '');
      setMaskedApiKey('');
      setMaskedAuthToken('');
      setStatus('loaded');
    } catch (err: any) {
      setStatus('error');
      setErrorMsg(err.message || 'Failed to load Claude config');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/50" onClick={() => setShow(false)}>
      <div className="w-[480px] bg-bg-secondary border border-border rounded-xl shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="px-6 py-4 border-b border-border flex items-center justify-between">
          <h2 className="text-sm font-semibold text-text-primary">AI Configuration</h2>
          <button onClick={() => setShow(false)} className="text-text-muted hover:text-text-primary">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M2 2L12 12M12 2L2 12" />
            </svg>
          </button>
        </div>
        <div className="px-6 py-4 space-y-4">
          <p className="text-[11px] text-text-muted">
            Configure Anthropic API credentials. Either API Key or Auth Token is required.
          </p>

          <div className="space-y-3">
            <Field label="Base URL" value={baseUrl} onChange={setBaseUrl} placeholder="https://api.anthropic.com" />
            <SecretField label="API Key" value={apiKey} onChange={setApiKey} placeholder="sk-ant-..." maskedValue={maskedApiKey} />
            <SecretField label="Auth Token" value={authToken} onChange={setAuthToken} placeholder="(alternative to API Key)" maskedValue={maskedAuthToken} />
          </div>

          <div className="pt-2 border-t border-border/50 space-y-3">
            <p className="text-[11px] text-text-muted">
              Quality Model is used for single operations (rename, summary, deep search).
              Fast Model is used for batch processing (cheaper, e.g. Haiku).
            </p>
            <Field label="Quality Model" value={qualityModel} onChange={setQualityModel} placeholder="claude-sonnet-4-5-20250514" />
            <Field label="Fast Model" value={fastModel} onChange={setFastModel} placeholder="claude-haiku-4-5-20251001" />
          </div>

          {status === 'success' && (
            <div className="text-[11px] text-green-400 bg-green-500/10 px-3 py-2 rounded">
              Connected successfully
            </div>
          )}
          {status === 'loaded' && (
            <div className="text-[11px] text-blue-400 bg-blue-500/10 px-3 py-2 rounded">
              Loaded from Claude config — click Save & Verify to apply
            </div>
          )}
          {status === 'error' && (
            <div className="text-[11px] text-red-400 bg-red-500/10 px-3 py-2 rounded">
              {errorMsg}
            </div>
          )}
        </div>
        <div className="px-6 py-3 border-t border-border flex items-center justify-between gap-2">
          <button
            onClick={handleLoadFromClaude}
            disabled={loading || saving}
            className="px-3 py-1.5 text-xs text-text-muted hover:text-text-primary border border-border rounded-md hover:border-border-hover disabled:opacity-50 transition-colors"
            title="Load credentials from ~/.claude/settings.json and environment variables"
          >
            {loading ? 'Loading...' : 'Load from Claude'}
          </button>
          <div className="flex gap-2">
            <button
              onClick={() => setShow(false)}
              className="px-3 py-1.5 text-xs text-text-muted hover:text-text-primary transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={saving || (!apiKey && !authToken && !maskedApiKey && !maskedAuthToken)}
              className="px-4 py-1.5 text-xs bg-accent text-white rounded-md hover:bg-accent/90 disabled:opacity-50 transition-colors"
            >
              {saving ? 'Verifying...' : 'Save & Verify'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Field({ label, value, onChange, placeholder }: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <div className="flex items-center gap-3">
      <label className="w-28 text-[11px] text-text-muted text-right shrink-0">{label}</label>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="flex-1 px-2.5 py-1.5 text-xs bg-bg-primary border border-border rounded-md text-text-primary placeholder:text-text-muted/50 focus:outline-none focus:border-accent"
      />
    </div>
  );
}

function SecretField({ label, value, onChange, placeholder, maskedValue }: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  maskedValue: string;
}) {
  const [editing, setEditing] = useState(false);
  const [visible, setVisible] = useState(false);
  const hasExisting = !!maskedValue && !value && !editing;

  const EyeIcon = ({ open }: { open: boolean }) => open ? (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
      <line x1="1" y1="1" x2="23" y2="23" />
    </svg>
  ) : (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );

  return (
    <div className="flex items-center gap-3">
      <label className="w-28 text-[11px] text-text-muted text-right shrink-0">{label}</label>
      <div className="flex-1">
        <div className="flex items-center gap-1">
          {hasExisting ? (
            <span className="flex-1 px-2.5 py-1.5 text-xs bg-bg-primary border border-border rounded-md text-text-muted font-mono tracking-wide">
              {maskedValue}
            </span>
          ) : (
            <input
              type={visible ? 'text' : 'password'}
              value={value}
              onChange={(e) => onChange(e.target.value)}
              placeholder={placeholder}
              className="flex-1 px-2.5 py-1.5 text-xs bg-bg-primary border border-border rounded-md text-text-primary placeholder:text-text-muted/50 focus:outline-none focus:border-accent"
            />
          )}
          <button
            type="button"
            onClick={() => { if (hasExisting) { setEditing(true); setVisible(true); } else { setVisible(!visible); } }}
            className="w-7 h-7 flex items-center justify-center text-text-muted hover:text-text-primary transition-colors"
            title={hasExisting ? 'Edit' : visible ? 'Hide' : 'Show'}
          >
            <EyeIcon open={visible && !hasExisting} />
          </button>
        </div>
      </div>
    </div>
  );
}
