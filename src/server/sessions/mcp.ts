import { createMcpExtension, type InlineExtension } from "@earendil-works/pi-coding-agent";

/**
 * The extension that connects a hosted session to MCP servers.
 *
 * Pi's CLI loads MCP as the `builtin:mcp` extension; Forgerie builds sessions
 * with the SDK, which adds no built-in extensions, so it loads the same one.
 * Pi keeps all MCP behaviour: servers come from `mcp.json` in the active
 * profile (`PI_CODING_AGENT_DIR`, which sessiond pins) and, in trusted
 * projects, `.pi/mcp.json`. Their tools default to codemode exposure, so they
 * stay out of the model's tool declarations until a script searches for them.
 * `-builtin:mcp` in the profile's `extensions` setting removes it, and another
 * extension that registers `/mcp` replaces it.
 */
export function hostedMcpExtension(): InlineExtension {
  return { name: "mcp", factory: createMcpExtension(), replaceable: true, builtin: true };
}
