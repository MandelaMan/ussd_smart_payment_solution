import DOMPurify from "dompurify";

/** Sanitize server-rendered HTML before injecting into the DOM. */
export function sanitizeHtml(html: string): string {
  return DOMPurify.sanitize(html, {
    USE_PROFILES: { html: true },
    ADD_ATTR: ["target"],
  });
}
