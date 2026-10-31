import { CorsHeaders } from './types';

export function getCorsHeaders(origin: string | null, allowedOrigin: string): CorsHeaders {
	const headers: CorsHeaders = {
		'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS',
		'Access-Control-Allow-Headers': 'Content-Type, Authorization',
		'Access-Control-Max-Age': '86400',
		Vary: 'Origin',
	};
	if (origin && origin === allowedOrigin) headers['Access-Control-Allow-Origin'] = origin;
	return headers;
}

export function jsonResponse(data: unknown, status = 200, cors: CorsHeaders = {}): Response {
	return new Response(JSON.stringify(data), {
		status,
		headers: { 'Content-Type': 'application/json', ...cors },
	});
}

export function errorResponse(message: string, status = 400, cors: CorsHeaders = {}): Response {
	return jsonResponse({ error: message }, status, cors);
}

/**
 * Clean a user-supplied relative path before it becomes part of an R2 key:
 * strips null bytes, converts backslashes, drops empty / `.` / `..` segments
 * (blocks traversal). Keeps a trailing slash so folder markers survive.
 */
export function sanitizeRelativePath(pathStr: string): string {
	if (!pathStr || typeof pathStr !== 'string') return '';

	const clean = pathStr.replace(/\0/g, '').replace(/\\/g, '/');
	const hasTrailingSlash = clean.endsWith('/');

	const parts = clean.split('/').filter((part) => {
		const p = part.trim();
		return p !== '' && p !== '.' && p !== '..';
	});
	if (parts.length === 0) return '';

	return parts.join('/') + (hasTrailingSlash ? '/' : '');
}

/** Every user's objects live under their own prefix, keyed by Google `sub`. */
export function userPrefix(sub: string): string {
	return `users/${sub}/`;
}

/**
 * Unguessable short id for public links. Uses a CSPRNG with rejection sampling
 * so every character is uniformly distributed (never Math.random()).
 */
export function generateShortId(length = 10): string {
	const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
	const max = 256 - (256 % chars.length);
	let id = '';
	const buf = new Uint8Array(length * 2);
	while (id.length < length) {
		crypto.getRandomValues(buf);
		for (const byte of buf) {
			if (byte >= max) continue;
			id += chars.charAt(byte % chars.length);
			if (id.length === length) break;
		}
	}
	return id;
}
