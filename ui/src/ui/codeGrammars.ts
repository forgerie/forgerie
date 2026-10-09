import hljs from "highlight.js";

/**
 * The grammars a fence label may name. The full highlight.js build, not its
 * `common` subset: `common` carries 36 languages and leaves out nix, dockerfile,
 * cmake, powershell, elixir, matlab, nim and about 150 more, so those fences
 * drew as plain text. A label highlight.js has no grammar for is still plain
 * text; nothing is guessed for it.
 *
 * The transcript and the composer share this instance, so both call the same
 * label a code fence (composerCodeLanguage.ts).
 */
export default hljs;
