import { describe, it, expect } from 'vitest';
import { generateShortId, sanitizeRelativePath } from '../src/utils';

describe('sanitizeRelativePath', () => {
	it('drops traversal, dots, empty segments and null bytes', () => {
		expect(sanitizeRelativePath('../a/./b//c\0')).toBe('a/b/c');
		expect(sanitizeRelativePath('..\\..\\etc\\passwd')).toBe('etc/passwd');
	});
	it('keeps a trailing slash', () => {
		expect(sanitizeRelativePath('a/b/')).toBe('a/b/');
	});
	it('returns empty for junk', () => {
		expect(sanitizeRelativePath('')).toBe('');
		expect(sanitizeRelativePath('../..')).toBe('');
	});
});

describe('generateShortId', () => {
	it('has the requested length and alphabet', () => {
		expect(generateShortId()).toMatch(/^[A-Za-z0-9]{10}$/);
		expect(generateShortId(24)).toHaveLength(24);
	});
});
