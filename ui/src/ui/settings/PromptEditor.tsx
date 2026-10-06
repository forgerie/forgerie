import { useEditor, EditorContent, useEditorState, type Editor } from "@tiptap/react";
import { BubbleMenu } from "@tiptap/react/menus";
import StarterKit from "@tiptap/starter-kit";
import { Markdown } from "@tiptap/markdown";
import Placeholder from "@tiptap/extension-placeholder";
import { BoldIcon, CodeIcon, Heading2Icon, ItalicIcon, ListIcon, ListOrderedIcon, QuoteIcon, type LucideIcon } from "lucide-react";
import { useEffect, useRef } from "react";
import { keepPromptTextLiteral } from "../../agents/promptMarkdown";

interface Format { key: string; label: string; icon: LucideIcon; active: (editor: Editor) => boolean; run: (editor: Editor) => void }
// The marks and blocks a prompt actually uses. Everything else stays typeable as Markdown.
const FORMATS: Format[] = [
  { key: "bold", label: "Bold", icon: BoldIcon, active: (e) => e.isActive("bold"), run: (e) => e.chain().focus().toggleBold().run() },
  { key: "italic", label: "Italic", icon: ItalicIcon, active: (e) => e.isActive("italic"), run: (e) => e.chain().focus().toggleItalic().run() },
  { key: "code", label: "Code", icon: CodeIcon, active: (e) => e.isActive("code"), run: (e) => e.chain().focus().toggleCode().run() },
  { key: "heading", label: "Heading", icon: Heading2Icon, active: (e) => e.isActive("heading"), run: (e) => e.chain().focus().toggleHeading({ level: 2 }).run() },
  { key: "bullets", label: "Bulleted list", icon: ListIcon, active: (e) => e.isActive("bulletList"), run: (e) => e.chain().focus().toggleBulletList().run() },
  { key: "numbers", label: "Numbered list", icon: ListOrderedIcon, active: (e) => e.isActive("orderedList"), run: (e) => e.chain().focus().toggleOrderedList().run() },
  { key: "quote", label: "Quote", icon: QuoteIcon, active: (e) => e.isActive("blockquote"), run: (e) => e.chain().focus().toggleBlockquote().run() },
];

function FormatMenu({ editor }: { editor: Editor }) {
  const active = useEditorState({ editor, selector: ({ editor: current }) => FORMATS.map((format) => format.active(current)) });
  return <BubbleMenu editor={editor} className="prompt-format" options={{ placement: "top", offset: 8 }}>
    {FORMATS.map((format, index) => <button key={format.key} type="button" aria-label={format.label} title={format.label}
      aria-pressed={active[index] ?? false} onMouseDown={(event) => event.preventDefault()} onClick={() => format.run(editor)}>
      <format.icon aria-hidden size={15} />
    </button>)}
  </BubbleMenu>;
}

/**
 * System organism: an agent's instructions as WYSIWYG Markdown, styled like a
 * reply in the transcript, so a prompt reads the same while it is written and
 * when the agent works from it. Markdown typed as text (`## `, `- `, `**`)
 * becomes formatting; selecting text offers the common marks.
 */
export function PromptEditor({ initial, readOnly, label, onChange }: {
  /** Markdown, read once when the editor mounts. */
  initial: string;
  readOnly?: boolean;
  label: string;
  onChange: (markdown: string) => void;
}) {
  const change = useRef(onChange);
  useEffect(() => { change.current = onChange; }, [onChange]);
  const editor = useEditor({
    extensions: [
      StarterKit.configure({ link: { openOnClick: false } }),
      Markdown,
      Placeholder.configure({ placeholder: "Tell the agent what it is for and how to do the work." }),
    ],
    content: initial,
    contentType: "markdown",
    editable: !readOnly,
    immediatelyRender: true,
    editorProps: { attributes: { class: "prompt-document markdown", "aria-label": label, "aria-multiline": "true", role: "textbox" } },
    onCreate: ({ editor: created }) => keepPromptTextLiteral(created),
    onUpdate: ({ editor: changed }) => change.current(changed.getMarkdown()),
  });
  return <div className="prompt-editor" data-readonly={readOnly || undefined}>
    <EditorContent editor={editor} />
    {editor && !readOnly ? <FormatMenu editor={editor} /> : null}
  </div>;
}
