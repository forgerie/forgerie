import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { FileLockIcon, PencilOffIcon } from "lucide-react";
import { useMarkdownKit, type MarkdownKit } from "./markdownKit";
import { frameMarkdownBody, joinFrontMatter, splitFrontMatter } from "./markdownText";
import "./MarkdownEditor.css";

/** Something the reader must know before they edit, with the one action that resolves it. */
export interface MarkdownNotice {
  message: string;
  action?: { label: string; onPress: () => void } | undefined;
}

/** A link in the document never takes the reader away from the file. */
const holdLink = (_view: unknown, event: MouseEvent) => {
  if (event.target instanceof Element && event.target.closest("a")) event.preventDefault();
  return false;
};

/**
 * Organism: a Markdown file, formatted the way a reply in the transcript is,
 * and editable in place. YAML front matter sits above the body as a code
 * block the reader can read and copy but not change. The text is read once
 * when the editor mounts; the caller keys it by document and view, so a
 * switch remounts it from the current text and the file changes only when
 * the reader types.
 */
export function MarkdownEditor({ label, text, readOnly = false, notice, placeholder = "Empty file. Start writing.",
  emptyReadOnly = "Empty file.", frontMatterLabel = "Front matter", onChange, onSave }: {
  /** The editor's accessible name. */
  label: string;
  /** The whole file, front matter included. Later changes are ignored: the editor owns the document from then on. */
  text: string;
  /** Shows the file formatted and refuses edits; selecting and copying still work. */
  readOnly?: boolean | undefined;
  /** Shown above the file, such as why it is read-only and how to edit it anyway. */
  notice?: MarkdownNotice | undefined;
  /** Shown in an empty file the reader can write in. */
  placeholder?: string;
  /** Shown in an empty file the reader cannot change. */
  emptyReadOnly?: string;
  /** Names the front matter block. */
  frontMatterLabel?: string;
  onChange: (text: string) => void;
  /** Control or Command with S. */
  onSave: () => void;
}) {
  const noticeId = useId();
  const host = useRef<HTMLDivElement>(null);
  const editor = useRef<InstanceType<MarkdownKit["Editor"]>>(undefined);
  const latest = useRef({ onChange, onSave });
  latest.current = { onChange, onSave };
  // Tiptap loads with the first Markdown file shown formatted; until then the front matter shows and the body holds its place.
  const kit = useMarkdownKit();
  // The file as it opened: its front matter stays as it is, and the body is what the editor edits.
  const [initial] = useState(() => ({ text, readOnly, placeholder: readOnly ? emptyReadOnly : placeholder }));
  const [opened] = useState(() => ({ text: initial.text, ...splitFrontMatter(initial.text) }));
  const described = notice !== undefined;
  const editorProps = useMemo(() => ({
    attributes: {
      class: "markdown", "aria-label": label, "aria-multiline": "true", role: "textbox",
      ...readOnly ? { "aria-readonly": "true" } : {},
      ...described ? { "aria-describedby": noticeId } : {},
    },
    handleDOMEvents: { click: holdLink, auxclick: holdLink },
  }), [label, readOnly, described, noticeId]);
  const props = useRef(editorProps);
  props.current = editorProps;

  useLayoutEffect(() => {
    const element = host.current;
    if (!kit || !element) return;
    // The body as the editor first writes it back, before any edit.
    let serialized: string | undefined;
    const created = new kit.Editor({
      element,
      extensions: [
        ...kit.markdownExtensions(),
        kit.Placeholder.configure({ placeholder: initial.placeholder, showOnlyWhenEditable: false }),
        kit.Extension.create({
          name: "saveShortcut",
          addKeyboardShortcuts: () => ({ "Mod-s": () => { latest.current.onSave(); return true; } }),
        }),
      ],
      content: opened.body,
      contentType: "markdown",
      editable: !initial.readOnly,
      editorProps: props.current,
      onCreate: ({ editor: ready }) => { serialized = ready.getMarkdown(); },
      onUpdate: ({ editor: changed }) => {
        const markdown = changed.getMarkdown();
        // Back where it started, the file is its own bytes again, so undoing every edit leaves nothing to save.
        // Otherwise the body keeps the blank lines before it and the newlines after it, which Tiptap does not write.
        latest.current.onChange(markdown === serialized ? opened.text
          : joinFrontMatter({ frontMatter: opened.frontMatter, body: frameMarkdownBody(opened.body, markdown) }));
      },
    });
    editor.current = created;
    return () => { editor.current = undefined; created.destroy(); };
  }, [kit, opened, initial]);
  useEffect(() => {
    editor.current?.setOptions({ editorProps });
    editor.current?.setEditable(!readOnly, false);
  }, [editorProps, readOnly]);

  return <div className="markdown-editor" data-readonly={readOnly || undefined}>
    {notice ? <div className="markdown-editor-notice" id={noticeId}>
      <PencilOffIcon className="markdown-editor-notice-icon" aria-hidden size={16} />
      <p className="markdown-editor-notice-text">{notice.message}</p>
      {notice.action ? <button type="button" className="markdown-editor-notice-action" onClick={notice.action.onPress}>{notice.action.label}</button> : null}
    </div> : null}
    {opened.frontMatter !== null ? <figure className="markdown-editor-front">
      <figcaption className="markdown-editor-front-label"><FileLockIcon aria-hidden size={14} />{frontMatterLabel}</figcaption>
      <pre className="markdown-editor-front-code"><code>{opened.frontMatter.replace(/\r?\n$/u, "")}</code></pre>
    </figure> : null}
    <div className="markdown-editor-body" aria-busy={kit ? undefined : true}>
      <div ref={host} />
    </div>
  </div>;
}
