# MCP servers

Hosted sessions load Pi's built-in MCP extension, the same one terminal `pi` loads. Forgerie adds no MCP behaviour of its own. Pi's [MCP guide](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/mcp.md) is the reference for the configuration format.

## Configure servers

Pi reads servers from `mcp.json` in the active profile (`$PI_CODING_AGENT_DIR/mcp.json`) and, in trusted projects, from `.pi/mcp.json`. Sessiond pins `PI_CODING_AGENT_DIR` to Forgerie's profile, so terminal `pi` and Forgerie keep separate server lists. Forgerie never writes `mcp.json`.

```json
{
  "mcpServers": {
    "example": { "command": "npx", "args": ["-y", "example-mcp@1.2.3"] }
  }
}
```

Pi reads `mcp.json` when a session starts. Start a new session after you change it.

## How the model reaches the tools

Pi registers each tool as `mcp__<server>__<tool>`. The default `"exposure": "codemode"` keeps them out of the model's tool declarations. A codemode script finds them with `searchTools()` and calls them through `tools`. `"direct"` declares the tools to the model, and the first prompt waits up to 10 seconds for those servers. `"hidden"` makes a server unreachable.

MCP tools have no Durable replay contract, so recovery does not rerun them. See [parent tool replay](durable-tool-replay.md).

## Costs and limits

- Each hosted session starts its own connection. A stdio server runs one process per open session and stops when the session closes.
- The interactive `/mcp` manager and OAuth sign-in use terminal dialogs. They are untested in the browser. Edit `mcp.json` directly instead.
- `-builtin:mcp` in the profile's `extensions` setting turns MCP off for every session.
