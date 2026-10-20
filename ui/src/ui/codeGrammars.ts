import hljs from "highlight.js";

/**
 * The grammars a fence label may name. The full highlight.js build, not its
 * `common` subset: `common` carries 36 languages and leaves out nix, dockerfile,
 * cmake, powershell, elixir, matlab, nim and about 150 more, so those fences
 * drew as plain text. A label highlight.js has no grammar for is still plain
 * text; nothing is guessed for it.
 *
 * This optional module loads on the first completed known code fence. The
 * composer uses its checked name registry (codeLanguageNames.ts), not these
 * grammar implementations, so both recognize the same labels without putting
 * the full highlighter on the initial application path.
 */
export default hljs;
