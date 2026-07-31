import DOMPurify from "dompurify";

/** Sanitize server-rendered HTML before injecting into the DOM. */
export function sanitizeHtml(html: string): string {
  return DOMPurify.sanitize(html, {
    USE_PROFILES: { html: true },
    // Keep target/style/class for mail layout; omit `id` to reduce DOM clobbering.
    ADD_ATTR: ["target", "style", "class"],
    // Keep common mail markup (quotes, tables, lists) so threads aren't clipped.
    ADD_TAGS: ["blockquote", "table", "thead", "tbody", "tr", "td", "th", "colgroup", "col"],
    FORBID_TAGS: ["form", "input", "button", "textarea", "select", "option"],
  });
}
