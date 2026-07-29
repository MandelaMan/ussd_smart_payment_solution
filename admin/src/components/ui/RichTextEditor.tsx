import { useEffect, type ReactNode } from "react";
import { Box, Button, Flex, IconButton } from "@chakra-ui/react";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Underline from "@tiptap/extension-underline";
import Link from "@tiptap/extension-link";
import Placeholder from "@tiptap/extension-placeholder";
import {
  FiBold,
  FiItalic,
  FiUnderline,
  FiList,
  FiLink,
  FiType,
  FiHash,
} from "react-icons/fi";
import { fieldControlStyles } from "../../theme";
import { sanitizeHtml } from "../../lib/sanitizeHtml";

type Props = {
  value: string;
  onChange: (html: string) => void;
  placeholder?: string;
  minH?: string;
  disabled?: boolean;
};

function ToolbarButton({
  label,
  active,
  disabled,
  onClick,
  children,
}: {
  label: string;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <IconButton
      aria-label={label}
      title={label}
      size="xs"
      variant={active ? "solid" : "ghost"}
      colorPalette={active ? "brand" : "gray"}
      disabled={disabled}
      onMouseDown={(e) => {
        e.preventDefault();
        onClick();
      }}
    >
      {children}
    </IconButton>
  );
}

/** Returns true when TipTap HTML has no visible text. */
export function isRichTextEmpty(html: string): boolean {
  const text = html
    .replace(/<br\s*\/?>/gi, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/<[^>]+>/g, "")
    .trim();
  return text.length === 0;
}

export function RichTextEditor({
  value,
  onChange,
  placeholder = "Write your message…",
  minH = "220px",
  disabled = false,
}: Props) {
  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({
        heading: { levels: [2, 3] },
      }),
      Underline,
      Link.configure({
        openOnClick: false,
        HTMLAttributes: { rel: "noopener noreferrer", target: "_blank" },
      }),
      Placeholder.configure({ placeholder }),
    ],
    content: value || "",
    editable: !disabled,
    onUpdate: ({ editor: ed }) => {
      onChange(ed.getHTML());
    },
    editorProps: {
      attributes: {
        class: "rich-text-editor-content",
      },
    },
  });

  useEffect(() => {
    if (!editor) return;
    const current = editor.getHTML();
    const next = value || "";
    if (current !== next && !(isRichTextEmpty(current) && isRichTextEmpty(next))) {
      editor.commands.setContent(next, false);
    }
  }, [editor, value]);

  useEffect(() => {
    if (!editor) return;
    editor.setEditable(!disabled);
  }, [editor, disabled]);

  function setLink() {
    if (!editor) return;
    const previous = editor.getAttributes("link").href as string | undefined;
    const url = window.prompt("Link URL", previous || "https://");
    if (url === null) return;
    const trimmed = url.trim();
    if (!trimmed) {
      editor.chain().focus().extendMarkRange("link").unsetLink().run();
      return;
    }
    editor
      .chain()
      .focus()
      .extendMarkRange("link")
      .setLink({ href: trimmed })
      .run();
  }

  if (!editor) return null;

  return (
    <Box
      w="full"
      borderWidth="1px"
      borderColor="border"
      borderRadius="md"
      bg={fieldControlStyles.bg}
      boxShadow={fieldControlStyles.boxShadow}
      overflow="hidden"
      opacity={disabled ? 0.7 : 1}
    >
      <Flex
        gap={0.5}
        px={2}
        py={1.5}
        borderBottomWidth="1px"
        borderColor="border"
        bg="bg.muted"
        flexWrap="wrap"
        align="center"
      >
        <ToolbarButton
          label="Bold"
          active={editor.isActive("bold")}
          disabled={disabled}
          onClick={() => editor.chain().focus().toggleBold().run()}
        >
          <FiBold />
        </ToolbarButton>
        <ToolbarButton
          label="Italic"
          active={editor.isActive("italic")}
          disabled={disabled}
          onClick={() => editor.chain().focus().toggleItalic().run()}
        >
          <FiItalic />
        </ToolbarButton>
        <ToolbarButton
          label="Underline"
          active={editor.isActive("underline")}
          disabled={disabled}
          onClick={() => editor.chain().focus().toggleUnderline().run()}
        >
          <FiUnderline />
        </ToolbarButton>
        <ToolbarButton
          label="Heading"
          active={editor.isActive("heading", { level: 2 })}
          disabled={disabled}
          onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
        >
          <FiType />
        </ToolbarButton>
        <ToolbarButton
          label="Bullet list"
          active={editor.isActive("bulletList")}
          disabled={disabled}
          onClick={() => editor.chain().focus().toggleBulletList().run()}
        >
          <FiList />
        </ToolbarButton>
        <ToolbarButton
          label="Numbered list"
          active={editor.isActive("orderedList")}
          disabled={disabled}
          onClick={() => editor.chain().focus().toggleOrderedList().run()}
        >
          <FiHash />
        </ToolbarButton>
        <ToolbarButton
          label="Link"
          active={editor.isActive("link")}
          disabled={disabled}
          onClick={setLink}
        >
          <FiLink />
        </ToolbarButton>
        <Button
          size="xs"
          variant="ghost"
          disabled={disabled || editor.isActive("paragraph")}
          onMouseDown={(e) => {
            e.preventDefault();
            editor.chain().focus().setParagraph().run();
          }}
        >
          Clear style
        </Button>
      </Flex>
      <Box
        w="full"
        px={3}
        py={2}
        minH={minH}
        maxH="360px"
        overflowY="auto"
        css={{
          "& .tiptap, & .ProseMirror, & .rich-text-editor-content": {
            width: "100%",
            maxWidth: "100%",
            outline: "none",
            minHeight: minH,
            fontSize: "0.925rem",
            lineHeight: 1.55,
            boxSizing: "border-box",
          },
          "& > div": {
            width: "100%",
          },
          "& .rich-text-editor-content p": { margin: "0 0 0.65em" },
          "& .rich-text-editor-content p:last-child": { marginBottom: 0 },
          "& .rich-text-editor-content h2": {
            fontSize: "1.15rem",
            fontWeight: 700,
            margin: "0 0 0.5em",
          },
          "& .rich-text-editor-content ul, & .rich-text-editor-content ol": {
            paddingLeft: "1.25rem",
            margin: "0 0 0.65em",
          },
          "& .rich-text-editor-content a": {
            color: "var(--chakra-colors-brand-600)",
            textDecoration: "underline",
          },
          "& .rich-text-editor-content p.is-editor-empty:first-child::before": {
            color: "var(--chakra-colors-fg-muted)",
            content: "attr(data-placeholder)",
            float: "left",
            height: 0,
            pointerEvents: "none",
          },
        }}
      >
        <EditorContent editor={editor} style={{ width: "100%" }} />
      </Box>
    </Box>
  );
}

/** Sanitize HTML before sending to the mail API. */
export function sanitizeEmailHtml(html: string): string {
  return sanitizeHtml(html);
}
