/**
 * The only addresses the app ever hands to the system browser: plain http(s)
 * without embedded credentials. Kept apart from the sanitizer so the reading
 * frame can import it without pulling in DOMPurify.
 */
export function safeHttpLink(raw: string) {
  try {
    const url = new URL(raw);
    if (!["https:", "http:"].includes(url.protocol)) return "";
    if (url.username || url.password) return "";
    return url.toString();
  } catch {
    return "";
  }
}
