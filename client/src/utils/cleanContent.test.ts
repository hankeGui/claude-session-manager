import { describe, it, expect } from 'vitest';
import { cleanMessageContent } from './cleanContent';

describe('cleanMessageContent', () => {
  it('returns empty string for empty input', () => {
    expect(cleanMessageContent('')).toBe('');
  });

  it('passes through normal text', () => {
    expect(cleanMessageContent('Hello world')).toBe('Hello world');
  });

  it('strips system-reminder tags', () => {
    const input = 'Before <system-reminder>secret stuff</system-reminder> After';
    const result = cleanMessageContent(input);
    expect(result).not.toContain('system-reminder');
    expect(result).not.toContain('secret stuff');
    expect(result).toContain('Before');
    expect(result).toContain('After');
  });

  it('strips multiple system-reminder tags', () => {
    const input = 'A <system-reminder>x</system-reminder> B <system-reminder>y</system-reminder> C';
    const result = cleanMessageContent(input);
    expect(result).toContain('A');
    expect(result).toContain('B');
    expect(result).toContain('C');
    expect(result).not.toContain('x');
    expect(result).not.toContain('y');
  });

  it('strips local-command-caveat tags', () => {
    const input = 'Text <local-command-caveat>hidden</local-command-caveat> more';
    expect(cleanMessageContent(input)).not.toContain('hidden');
  });

  it('converts command-name to /command', () => {
    const input = '<command-name>commit</command-name>';
    expect(cleanMessageContent(input)).toBe('/commit');
  });

  it('strips command-message tags', () => {
    const input = 'A <command-message>msg</command-message> B';
    const result = cleanMessageContent(input);
    expect(result).not.toContain('msg');
  });

  it('converts local-command-stdout to arrow format', () => {
    const input = '<local-command-stdout>output</local-command-stdout>';
    expect(cleanMessageContent(input)).toContain('→ output');
  });

  it('collapses multiple newlines', () => {
    const input = 'A\n\n\n\n\nB';
    expect(cleanMessageContent(input)).toBe('A\n\nB');
  });

  it('handles multiline system-reminder content', () => {
    const input = 'Start\n<system-reminder>\nline1\nline2\n</system-reminder>\nEnd';
    const result = cleanMessageContent(input);
    expect(result).toContain('Start');
    expect(result).toContain('End');
    expect(result).not.toContain('line1');
  });
});
