import { Env } from './types';
import { errorResponse, getCorsHeaders, jsonResponse } from './utils';
import { verifyGoogleToken } from './modules/auth';
import { createFolder, deleteFiles, downloadFile, listFiles, uploadFile } from './modules/files';
import { createShare, purgeExpiredShares, resolveShare } from './modules/share';

export default {
	async fetch(request: Request, env: Env): Promise<Response> {
		const url = new URL(request.url);
		const cors = getCorsHeaders(request.headers.get('Origin'), env.FRONTEND_URL);

		if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });

		try {
			// ---- Public routes (no auth) ----
			if (request.method === 'GET' && url.pathname === '/health') return jsonResponse({ ok: true }, 200, cors);

			const shareMatch = url.pathname.match(/^\/share\/([^/]+)$/);
			if (request.method === 'GET' && shareMatch) return await resolveShare(shareMatch[1], env, cors);

			// ---- Protected routes: Authorization: Bearer <Google ID token> ----
			const token = request.headers.get('Authorization')?.match(/^Bearer (.+)$/)?.[1];
			if (!token) return errorResponse('Unauthorized', 401, cors);
			const user = await verifyGoogleToken(token, env);
			if (!user) return errorResponse('Unauthorized', 401, cors);

			const route = `${request.method} ${url.pathname}`;
			switch (route) {
				case 'GET /files':
					return await listFiles(request, env, user, cors);
				case 'PUT /files':
					return await uploadFile(request, env, user, cors);
				case 'GET /files/download':
					return await downloadFile(request, env, user, cors);
				case 'POST /files/delete':
					return await deleteFiles(request, env, user, cors);
				case 'POST /folders':
					return await createFolder(request, env, user, cors);
				case 'POST /share/create':
					return await createShare(request, env, user, cors);
				case 'GET /me':
					return jsonResponse(user, 200, cors);
			}

			return errorResponse('Not found', 404, cors);
		} catch (error) {
			console.error('Unhandled error:', error);
			return errorResponse('Internal error', 500, cors);
		}
	},

	async scheduled(_controller: ScheduledController, env: Env): Promise<void> {
		const removed = await purgeExpiredShares(env);
		console.log(`Purged ${removed} expired share link(s)`);
	},
} satisfies ExportedHandler<Env>;
