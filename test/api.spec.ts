import { env, createExecutionContext, createScheduledController, waitOnExecutionContext } from 'cloudflare:test';
import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest';
import worker from '../src/index';

const IncomingRequest = Request<unknown, IncomingRequestCfProperties>;
const BASE = 'https://api.test';

function mockGoogle(sub = 'user-1') {
	return vi.spyOn(globalThis, 'fetch').mockImplementation(async () =>
		Response.json({
			sub,
			email: `${sub}@example.com`,
			email_verified: 'true',
			aud: env.GOOGLE_CLIENT_ID,
			iss: 'https://accounts.google.com',
			exp: String(Math.floor(Date.now() / 1000) + 3600),
		}),
	);
}

async function call(path: string, init: RequestInit = {}, token: string | null = 'token-user-1') {
	const headers = new Headers(init.headers);
	if (token) headers.set('Authorization', `Bearer ${token}`);
	// Real clients always send Content-Length; a Request built from a string does not.
	if (typeof init.body === 'string' && !headers.has('Content-Length')) {
		headers.set('Content-Length', String(new TextEncoder().encode(init.body).length));
	}
	const request = new IncomingRequest(BASE + path, { ...init, headers });
	const ctx = createExecutionContext();
	const res = await worker.fetch(request, env);
	await waitOnExecutionContext(ctx);
	return res;
}

beforeAll(async () => {
	await env.DB.prepare(
		'CREATE TABLE IF NOT EXISTS share_links (id TEXT PRIMARY KEY, owner_sub TEXT NOT NULL, object_key TEXT NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL)',
	).run();
});

afterEach(() => vi.restoreAllMocks());

describe('auth', () => {
	it('health is public', async () => {
		expect((await call('/health', {}, null)).status).toBe(200);
	});
	it('rejects a missing token', async () => {
		expect((await call('/files', {}, null)).status).toBe(401);
	});
	it('rejects a token for another client id', async () => {
		vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ sub: 'x', email: 'x@e.com', aud: 'other', iss: 'accounts.google.com' }));
		expect((await call('/files', {}, 'bad-aud-token')).status).toBe(401);
	});
});

describe('files', () => {
	it('uploads, lists, downloads and deletes under the caller prefix', async () => {
		mockGoogle('user-files');
		const t = 'token-files';
		const body = 'hello world';

		const up = await call('/files?key=docs/hello.txt', { method: 'PUT', body, headers: { 'Content-Type': 'text/plain' } }, t);
		expect(up.status).toBe(201);
		expect(await env.BUCKET.head('users/user-files/docs/hello.txt')).not.toBeNull();

		const list = (await (await call('/files?prefix=docs', {}, t)).json()) as any;
		expect(list.files.map((f: any) => f.key)).toEqual(['docs/hello.txt']);

		const root = (await (await call('/files', {}, t)).json()) as any;
		expect(root.folders).toEqual(['docs/']);

		const dl = await call('/files/download?key=docs/hello.txt', {}, t);
		expect(await dl.text()).toBe(body);

		const del = await call('/files/delete', { method: 'POST', body: JSON.stringify({ keys: ['docs/hello.txt'] }) }, t);
		expect(del.status).toBe(200);
		expect(await env.BUCKET.head('users/user-files/docs/hello.txt')).toBeNull();
	});

	it('cannot escape the user prefix via path traversal', async () => {
		mockGoogle('user-trav');
		await call('/files?key=../other/evil.txt', { method: 'PUT', body: 'x' }, 'token-trav');
		expect(await env.BUCKET.head('users/user-trav/other/evil.txt')).not.toBeNull();
		expect(await env.BUCKET.head('users/other/evil.txt')).toBeNull();
	});

	it("does not serve another user's files", async () => {
		await env.BUCKET.put('users/someone-else/secret.txt', 'secret');
		mockGoogle('user-snoop');
		expect((await call('/files/download?key=secret.txt', {}, 'token-snoop')).status).toBe(404);
	});

	it('creates a folder marker', async () => {
		mockGoogle('user-folder');
		const res = await call('/folders', { method: 'POST', body: JSON.stringify({ path: 'a/b' }) }, 'token-folder');
		expect(res.status).toBe(201);
		expect(await env.BUCKET.head('users/user-folder/a/b/')).not.toBeNull();
	});
});

describe('share links', () => {
	it('creates a public link that serves the file, then expires and is purged', async () => {
		mockGoogle('user-share');
		await env.BUCKET.put('users/user-share/pic.txt', 'shared-bytes');

		const created = await call('/share/create', { method: 'POST', body: JSON.stringify({ key: 'pic.txt' }) }, 'token-share');
		expect(created.status).toBe(201);
		const { id } = (await created.json()) as { id: string };

		const pub = await call(`/share/${id}`, {}, null); // no auth
		expect(pub.status).toBe(200);
		expect(await pub.text()).toBe('shared-bytes');

		await env.DB.prepare('UPDATE share_links SET expires_at = ? WHERE id = ?').bind(Date.now() - 1000, id).run();
		const ctx = createExecutionContext();
		await worker.scheduled(createScheduledController(), env);
		await waitOnExecutionContext(ctx);
		expect((await call(`/share/${id}`, {}, null)).status).toBe(404);
	});

	it('404s when sharing a missing file', async () => {
		mockGoogle('user-share2');
		const res = await call('/share/create', { method: 'POST', body: JSON.stringify({ key: 'nope.txt' }) }, 'token-share2');
		expect(res.status).toBe(404);
	});
});
