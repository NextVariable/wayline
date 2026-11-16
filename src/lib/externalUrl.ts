export function safeExternalUrl(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length > 4000) return undefined;
  try {
    const url = new URL(value);
    if (url.protocol === "https:" && !url.username && !url.password) return url.href;
  } catch {
    return undefined;
  }
}
