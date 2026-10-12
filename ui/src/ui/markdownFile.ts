/**
 * The rich view's heavy half: Tiptap, its Markdown extensions and the
 * fidelity check. It loads on its own the first time a Markdown file opens
 * (`loadMarkdownKit` in markdownKit.ts), so the app's first load does not
 * carry an editor most visits never show. Import it statically only from a
 * part or a test.
 */
export { frameMarkdownBody, joinFrontMatter, markdownExtensions, richEditability, splitFrontMatter } from "../markdown/markdown";
export { Editor, Extension } from "@tiptap/core";
export { default as Placeholder } from "@tiptap/extension-placeholder";
