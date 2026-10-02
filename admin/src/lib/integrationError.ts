/** True when a partner API returned an HTML/XML fault page instead of a message. */
export function isIntegrationFaultDump(raw: string | null | undefined): boolean {
  return /<!DOCTYPE|<html\b|<\?xml|<style\b|<head\b/i.test(String(raw || ""));
}

/**
 * Collapse ASP.NET / WCF fault pages (and other markup dumps) to one sentence.
 * Short plain-text errors are returned unchanged.
 */
export function readableIntegrationError(raw: string | null | undefined): string {
  const text = String(raw ?? "").replace(/\s+/g, " ").trim();
  if (!text) return "";
  const markup = isIntegrationFaultDump(text);
  if (!markup && text.length <= 280) return text;

  const exception = text.match(/exception message is '([^']+)'/i);
  if (exception?.[1]) {
    const detail = exception[1].replace(/\.\s*$/, "").trim();
    return `Request failed: ${detail}.`;
  }

  const stripped = text
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/<!DOCTYPE[^>]*>/gi, " ")
    .replace(/<\?xml[^>]*\?>/gi, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^Request Error\s*/i, "")
    .split(/See server logs/i)[0]
    .trim();

  if (stripped && !/^at System\./i.test(stripped)) {
    const clipped = stripped.length > 180 ? `${stripped.slice(0, 177)}…` : stripped;
    return markup ? `Request failed: ${clipped.replace(/\.\s*$/, "")}.` : clipped;
  }

  return "Request failed. The service returned an internal error page.";
}
