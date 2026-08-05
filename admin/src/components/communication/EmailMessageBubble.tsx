import { Badge, Box, Flex, Text } from "@chakra-ui/react";
import { FiPaperclip } from "react-icons/fi";
import type { CustomerEmailMessage } from "../../lib/api";
import { sanitizeHtml } from "../../lib/sanitizeHtml";

function escapeText(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function stripToPlain(html: string): string {
  return String(html || "")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Pull inner markup out of full HTML documents before sanitizing for chat. */
function prepareMailHtml(html: string): string {
  let s = String(html || "");
  const bodyMatch = s.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  if (bodyMatch) s = bodyMatch[1];
  s = s.replace(/<\/?html[^>]*>/gi, "");
  s = s.replace(/<\/?head[^>]*>[\s\S]*?<\/head>/gi, "");
  s = s.replace(/<meta[^>]*>/gi, "");
  s = s.replace(/<style[\s\S]*?<\/style>/gi, "");
  // Light chat cards: neutralize pure white text that would vanish.
  s = s.replace(
    /color\s*:\s*(#fff(?:fff)?|white|rgb\(\s*255\s*,\s*255\s*,\s*255\s*\)|rgba\(\s*255\s*,\s*255\s*,\s*255\s*,\s*[^)]+\))/gi,
    "color: inherit"
  );
  return s.trim();
}

function hasVisibleContent(html: string): boolean {
  if (/<img\b/i.test(html)) return true;
  return stripToPlain(html).length > 0;
}

export function emailMessageHtml(msg: CustomerEmailMessage): string {
  const rawHtml = String(msg.bodyHtml || "").trim();
  if (rawHtml) {
    const prepared = prepareMailHtml(rawHtml);
    const safe = sanitizeHtml(prepared);
    if (hasVisibleContent(safe)) return safe;
  }

  const text = String(msg.bodyText || msg.summary || "").trim();
  if (text) {
    return escapeText(text).replace(/\n/g, "<br/>");
  }

  return `<em style="opacity:0.65">No message content</em>`;
}

function formatMsgTime(value: string | null | undefined): string {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  if (sameDay) {
    return d.toLocaleTimeString("en-KE", { hour: "2-digit", minute: "2-digit" });
  }
  return d.toLocaleString("en-KE", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

type Props = {
  message: CustomerEmailMessage;
  outboundLabel?: string;
};

/**
 * Email-card bubble (light sheet) so HTML mail stays readable.
 * Outbound is right-aligned with a brand accent; inbound left-aligned.
 */
export function EmailMessageBubble({
  message,
  outboundLabel = "Support",
}: Props) {
  const outbound = message.direction === "outbound";
  const fromLabel = outbound
    ? outboundLabel
    : message.fromAddress || "Customer";

  return (
    <Flex justify={outbound ? "flex-end" : "flex-start"} w="full">
      <Box
        maxW={{ base: "96%", md: "88%" }}
        w="fit-content"
        minW={{ base: "0", md: "220px" }}
        bg="bg.panel"
        color="fg"
        borderWidth="1px"
        borderColor={outbound ? "brand.200" : "border"}
        borderLeftWidth={outbound ? "3px" : "1px"}
        borderLeftColor={outbound ? "brand.500" : "border"}
        borderRadius="lg"
        px={3.5}
        py={2.5}
        boxShadow="xs"
      >
        {message.subject ? (
          <Text
            fontSize="xs"
            fontWeight="700"
            color="fg"
            mb={1.5}
            lineClamp={2}
          >
            {message.subject}
          </Text>
        ) : null}

        <Box
          fontSize="sm"
          lineHeight="1.5"
          color="fg"
          whiteSpace="normal"
          overflowWrap="anywhere"
          css={{
            "& *": {
              maxWidth: "100% !important",
              boxSizing: "border-box",
            },
            "& a": {
              color: "var(--chakra-colors-brand-600)",
              textDecoration: "underline",
            },
            "& p": { margin: "0 0 0.45em" },
            "& p:last-child": { marginBottom: 0 },
            "& blockquote": {
              margin: "0.55em 0",
              paddingLeft: "0.75em",
              borderLeft: "3px solid var(--chakra-colors-border)",
              color: "var(--chakra-colors-fg-muted)",
            },
            "& img": { maxWidth: "100%", height: "auto", borderRadius: "4px" },
            "& table": {
              maxWidth: "100%",
              display: "block",
              overflowX: "auto",
              borderCollapse: "collapse",
            },
            "& hr": {
              border: "none",
              borderTop: "1px solid var(--chakra-colors-border)",
              margin: "10px 0",
            },
            // Prefer readable text when mail HTML forces light colors.
            "& font, & span, & div, & td, & p, & li": {
              color: "inherit",
            },
          }}
          dangerouslySetInnerHTML={{ __html: emailMessageHtml(message) }}
        />

        {message.attachmentNames && message.attachmentNames.length > 0 ? (
          <Flex gap={1} flexWrap="wrap" mt={2}>
            {message.attachmentNames.map((name) => (
              <Badge
                key={`${message.id}-${name}`}
                colorPalette="gray"
                variant="subtle"
                size="sm"
              >
                <FiPaperclip /> {name}
              </Badge>
            ))}
          </Flex>
        ) : null}

        <Text fontSize="2xs" color="fg.muted" mt={2}>
          {fromLabel} · {formatMsgTime(message.createdAt)}
        </Text>
      </Box>
    </Flex>
  );
}
