// Server-side admin allow-list check and cron-secret check. Pure logic, easy to test.

export interface AuthUserLike {
  email?: string | null;
  user_metadata?: Record<string, unknown> | null;
}

/** Mirrors public.is_admin(): verified email that is in the allow-list. */
export function isAllowedAdmin(user: AuthUserLike | null | undefined, adminEmails: readonly string[]): boolean {
  if (!user?.email) return false;
  if (user.user_metadata?.email_verified !== true) return false;
  const email = user.email.toLowerCase();
  return adminEmails.some((a) => a.toLowerCase() === email);
}

export function bearerToken(header: string | null): string | null {
  if (!header) return null;
  const m = /^Bearer\s+(\S+)$/i.exec(header.trim());
  return m ? m[1] : null;
}

/** Constant-time string comparison. */
export function safeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const x = enc.encode(a);
  const y = enc.encode(b);
  let diff = x.length ^ y.length;
  const len = Math.max(x.length, y.length);
  for (let i = 0; i < len; i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

export function isValidCronSecret(header: string | null, expected: string | undefined): boolean {
  if (!expected || expected.length < 16 || !header) return false;
  return safeEqual(header, expected);
}
