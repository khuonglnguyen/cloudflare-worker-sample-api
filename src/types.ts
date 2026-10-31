export interface Env {
	/** R2 bucket holding file bytes (see wrangler.jsonc `r2_buckets`). */
	BUCKET: R2Bucket;
	/** D1 database holding share links (see `migrations/`). */
	DB: D1Database;
	/** Origin allowed by CORS. */
	FRONTEND_URL: string;
	/** Google OAuth client id the ID token must be issued for. */
	GOOGLE_CLIENT_ID: string;
}

export interface AuthUser {
	sub: string;
	email: string;
	name: string | null;
	picture: string | null;
}

export type CorsHeaders = Record<string, string>;
