import { AuthUser, CorsHeaders, Env } from '../types';
import { errorResponse, jsonResponse, sanitizeRelativePath, userPrefix } from '../utils';

const MAX_UPLOAD_BYTES = 100 * 1024 * 1024; // Workers cap request bodies by plan; keep a sane app limit.
const MAX_DELETE_KEYS = 100;

/** GET /files?prefix=&cursor= — one level of the caller's tree. */
export async function listFiles(request: Request, env: Env, user: AuthUser, cors: CorsHeaders): Promise<Response> {
	const url = new URL(request.url);
	const base = userPrefix(user.sub);
	let prefix = sanitizeRelativePath(url.searchParams.get('prefix') || '');
	if (prefix && !prefix.endsWith('/')) prefix += '/';

	const listed = await env.BUCKET.list({
		prefix: base + prefix,
		delimiter: '/',
		cursor: url.searchParams.get('cursor') || undefined,
		limit: 200,
	});

	const folders = listed.delimitedPrefixes.map((p) => p.slice(base.length));
	const files = listed.objects
		.filter((o) => o.key !== base + prefix) // hide the folder's own marker
		.map((o) => ({ key: o.key.slice(base.length), size: o.size, uploaded: o.uploaded.toISOString() }));

	return jsonResponse({ folders, files, cursor: listed.truncated ? listed.cursor : null }, 200, cors);
}

/** PUT /files?key=path/to/file.txt — body is the raw file bytes. */
export async function uploadFile(request: Request, env: Env, user: AuthUser, cors: CorsHeaders): Promise<Response> {
	const key = sanitizeRelativePath(new URL(request.url).searchParams.get('key') || '');
	if (!key || key.endsWith('/')) return errorResponse('Invalid key', 400, cors);

	const length = Number(request.headers.get('Content-Length'));
	if (!Number.isFinite(length) || length <= 0) return errorResponse('Content-Length required', 411, cors);
	if (length > MAX_UPLOAD_BYTES) return errorResponse('File too large', 413, cors);
	if (!request.body) return errorResponse('Empty body', 400, cors);

	await env.BUCKET.put(userPrefix(user.sub) + key, request.body, {
		httpMetadata: { contentType: request.headers.get('Content-Type') || 'application/octet-stream' },
	});

	return jsonResponse({ ok: true, key, size: length }, 201, cors);
}

/** GET /files/download?key= — stream the object back. */
export async function downloadFile(request: Request, env: Env, user: AuthUser, cors: CorsHeaders): Promise<Response> {
	const key = sanitizeRelativePath(new URL(request.url).searchParams.get('key') || '');
	if (!key || key.endsWith('/')) return errorResponse('Invalid key', 400, cors);

	const object = await env.BUCKET.get(userPrefix(user.sub) + key);
	if (!object) return errorResponse('Not found', 404, cors);

	const headers = new Headers(cors);
	object.writeHttpMetadata(headers);
	headers.set('ETag', object.httpEtag);
	return new Response(object.body, { headers });
}

/** POST /folders {path} — create an empty folder marker. */
export async function createFolder(request: Request, env: Env, user: AuthUser, cors: CorsHeaders): Promise<Response> {
	const body = (await request.json().catch(() => null)) as { path?: string } | null;
	const path = sanitizeRelativePath(body?.path || '').replace(/\/$/, '');
	if (!path) return errorResponse('Invalid path', 400, cors);

	await env.BUCKET.put(`${userPrefix(user.sub)}${path}/`, new Uint8Array(0));
	return jsonResponse({ ok: true, path }, 201, cors);
}

/** POST /files/delete {keys: string[]} — delete files (folders: pass the "dir/" marker key). */
export async function deleteFiles(request: Request, env: Env, user: AuthUser, cors: CorsHeaders): Promise<Response> {
	const body = (await request.json().catch(() => null)) as { keys?: unknown } | null;
	if (!body || !Array.isArray(body.keys) || body.keys.length === 0) return errorResponse('keys required', 400, cors);
	if (body.keys.length > MAX_DELETE_KEYS) return errorResponse(`At most ${MAX_DELETE_KEYS} keys`, 400, cors);

	const base = userPrefix(user.sub);
	const keys = body.keys
		.filter((k): k is string => typeof k === 'string')
		.map((k) => sanitizeRelativePath(k))
		.filter(Boolean)
		.map((k) => base + k);
	if (keys.length === 0) return errorResponse('No valid keys', 400, cors);

	await env.BUCKET.delete(keys);
	return jsonResponse({ ok: true, deleted: keys.length }, 200, cors);
}
