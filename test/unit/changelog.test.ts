import { describe, expect, it } from 'vitest';
import { extractSection, normalizeVersion } from '../../scripts/changelog-core';

const SAMPLE = [
  '# Changelog',
  '',
  '## [Unreleased]',
  '',
  '## [0.0.1] - 2026-09-26',
  '',
  '### Added',
  '',
  '- First release.',
  '',
  '## [0.0.0] - 2026-01-01',
  '',
  '- Older.',
  '',
  '[Unreleased]: https://example.com/compare/v0.0.1...HEAD',
  '[0.0.1]: https://example.com/releases/tag/v0.0.1',
].join('\n');

describe('normalizeVersion', () => {
  it('strips a leading v', () => {
    expect(normalizeVersion('v0.0.1')).toBe('0.0.1');
    expect(normalizeVersion('V0.0.1')).toBe('0.0.1');
  });

  it('trims whitespace', () => {
    expect(normalizeVersion('  0.0.1  ')).toBe('0.0.1');
  });
});

describe('extractSection', () => {
  it('extracts a version section without the heading', () => {
    expect(extractSection(SAMPLE, '0.0.1')).toBe('### Added\n\n- First release.');
  });

  it('accepts a v-prefixed version', () => {
    expect(extractSection(SAMPLE, 'v0.0.1')).toBe('### Added\n\n- First release.');
  });

  it('matches a heading without brackets', () => {
    expect(extractSection('## 0.1.0\n\n- x\n', '0.1.0')).toBe('- x');
  });

  it('does not match a longer version', () => {
    expect(extractSection(SAMPLE, '0.0.10')).toBeUndefined();
  });

  it('never treats Unreleased as a version', () => {
    expect(extractSection(SAMPLE, 'Unreleased')).toBeUndefined();
    expect(extractSection(SAMPLE, 'unreleased')).toBeUndefined();
  });

  it('returns undefined for an unknown version', () => {
    expect(extractSection(SAMPLE, '9.9.9')).toBeUndefined();
  });

  it('returns an empty string for an empty section', () => {
    expect(extractSection('## [0.1.0]\n\n## [0.1.1]\n\n- later\n', '0.1.0')).toBe('');
  });

  it('stops at the next level-2 heading', () => {
    expect(extractSection(SAMPLE, '0.0.0')).toBe('- Older.');
  });

  it('handles CRLF input', () => {
    expect(extractSection('## [0.1.0]\r\n\r\n- crlf\r\n', '0.1.0')).toBe('- crlf');
  });
});
