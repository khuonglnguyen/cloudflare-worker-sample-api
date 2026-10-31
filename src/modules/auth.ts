import { AuthUser, Env } from '../types';

const tokenCache = new Map<string, { user: AuthUser; expiresAt: number }>();
const CACHE_TTL_MS = 15 * 60 * 1000;
const CACHE_MAX = 1000;

/**
 * Verify a Google ID token (the frontend sends it as `Authorization: Bearer`).
 * Returns the user, or null if the token is invalid / for another client.
 */
export async function verifyGoogleToken(token: string, env: Env): Promise<AuthUser | null> {
	const now = Date.now();

	const cached = tokenCache.get(token);
	if (cached && cached.expiresAt > now) return cached.user;

	try {
		const res = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(token)}`);
		if (!res.ok) return null;

		const data = (await res.json()) as Record<string, any>;

		if (data.exp && Number(data.exp) * 1000 < now) return null;
		if (data.aud !== env.GOOGLE_CLIENT_ID) return null;
		if (data.iss !== 'https://accounts.google.com' && data.iss !== 'accounts.google.com') return null;
		if (data.email_verified === false || data.email_verified === 'false') return null;
		if (!data.sub || !data.email) return null;

		const user: AuthUser = {
			sub: String(data.sub),
			email: String(data.email).toLowerCase().trim(),
			name: typeof data.name === 'string' && data.name.trim() ? data.name.trim().slice(0, 120) : null,
			// Only https avatars, so a tampered response can't inject another scheme.
			picture: typeof data.picture === 'string' && data.picture.startsWith('https://') ? data.picture : null,
		};

		tokenCache.set(token, { user, expiresAt: now + CACHE_TTL_MS });
		if (tokenCache.size > CACHE_MAX) {
			const oldest = tokenCache.keys().next().value;
			if (oldest) tokenCache.delete(oldest);
		}

		return user;
	} catch {
		return null;
	}
}
