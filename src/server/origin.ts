export function isAllowedOrigin(origin: string | null, appOrigin: string | undefined): boolean {
  if (!appOrigin) return false;
  try {
    const allowed = new URL(appOrigin);
    if (allowed.protocol !== "http:" && allowed.protocol !== "https:") return false;
    return origin === null || origin === allowed.origin;
  } catch {
    return false;
  }
}
