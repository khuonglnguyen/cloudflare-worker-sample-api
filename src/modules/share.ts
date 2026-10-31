import { AuthUser, CorsHeaders, Env } from '../types';
import { errorResponse, generateShortId, jsonResponse, sanitizeRelativePath, userPrefix } from '../utils';

const DEFAULT_TTL_SECONDS = 7 * 24 * 3600;
const MAX_TTL_SECONDS = 30 * 24 * 3600;

/** POST /share/create {key, expiresInSeconds?} — owner creates a public expiring link. */
export async function createShare(request: Request, env: Env, user: AuthUser, cors: CorsHeaders): Promise<Response> {
	const body = (await request.json().catch(() => null)) as { key?: string; expiresInSeconds?: number } | null;
	const key = sanitizeRelativePath(body?.key || '');
	if (!key || key.endsWith('/')) return errorResponse('Invalid key', 400, cors);

	const ttl = Math.min(Math.max(Math.floor(Number(body?.expiresInSeconds) || DEFAULT_TTL_SECONDS), 60), MAX_TTL_SECONDS);

	const objectKey = userPrefix(user.sub) + key;
	if (!(await env.BUCKET.head(objectKey))) return errorResponse('Not found', 404, cors);

	const now = Date.now();
	const id = generateShortId();
	await env.DB.prepare('INSERT INTO share_links (id, owner_sub, object_key, created_at, expires_at) VALUES (?, ?, ?, ?, ?)')
		.bind(id, user.sub, objectKey, now, now + ttl * 1000)
		.run();

	return jsonResponse({ id, path: `/share/${id}`, expiresAt: now + ttl * 1000 }, 201, cors);
}

/** GET /share/:id — public, unauthenticated. Streams the shared object. */
export async function resolveShare(id: string, env: Env, cors: CorsHeaders): Promise<Response> {
	if (!/^[A-Za-z0-9]{10}$/.test(id)) return errorResponse('Not found', 404, cors);

	const row = await env.DB.prepare('SELECT object_key, expires_at FROM share_links WHERE id = ?')
		.bind(id)
		.first<{ object_key: string; expires_at: number }>();
	if (!row) return errorResponse('Not found', 404, cors);

	if (row.expires_at < Date.now()) {
		await env.DB.prepare('DELETE FROM share_links WHERE id = ?').bind(id).run();
		return errorResponse('Link expired', 410, cors);
	}

	const object = await env.BUCKET.get(row.object_key);
	if (!object) return errorResponse('Not found', 404, cors);

	const headers = new Headers(cors);
	object.writeHttpMetadata(headers);
	const name = row.object_key.split('/').pop() || 'download';
	headers.set('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(name)}`);
	return new Response(object.body, { headers });
}

/** Cron: drop expired links. Returns how many were removed. */
export async function purgeExpiredShares(env: Env): Promise<number> {
	const res = await env.DB.prepare('DELETE FROM share_links WHERE expires_at < ?').bind(Date.now()).run();
	return res.meta.changes ?? 0;
}
