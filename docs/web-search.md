# Web search

Forgerie bundles the unpatched `pi-web-access` package at **0.39.0** in every hosted session. No package settings or search key are required. With no `web-search.json`, its `auto` provider uses keyless Exa MCP.

| Tool | Use |
| --- | --- |
| `web_search` | Search one query or a batch of `queries`. |
| `fetch_content` | Fetch readable content from one URL or several URLs. |
| `get_search_content` | Retrieve stored search results or fetched content. |
| `source_check` | Check a source or claim. Provider-specific capabilities can require credentials. |

The package can expose `web_enable` first for models that support cached tool additions. The model can enable the four registered tools without user configuration. Forgerie does not rename them.

## Profile configuration

`web-search.json` in the active Pi profile (`$PI_CODING_AGENT_DIR/web-search.json`) configures providers, routing, keys, and workflows. Forgerie never writes this file. The extension's own `/curator` command can write its workflow setting. See the bundled package's [configuration reference](https://github.com/nicobailon/pi-web-access#configuration) for optional settings. A profile can deliberately disable or rename tools; that is not the zero-config default.

Do not install another copy of `pi-web-access` into the profile. Forgerie drops another copy's tools and hooks and warns with the bundled path. A different extension that registers one of the four names stays loaded, but the bundled tool wins. The session warning names the losing extension. Its other tools remain available.

Search queries go to external search providers. Fetched pages and results are cached by the package in the profile's private `web-search-cache` directory, with a one-hour lifetime. Keyless Exa remains subject to the external service's availability and limits.

## Headless use and the curator

The default workflow is `"none"`: searches return results without opening a browser or starting the curator. `"auto-summary"` also avoids the browser, but summary generation can use model credentials.

`/curator off` keeps this default. `/curator on` selects `"summary-review"`. `/websearch` explicitly opens the separate curator, even when the default workflow is `"none"`. The remote curator works through `curatorRemote`, but it is untested from a real Tailscale client.

For remote use, configure an actual server Tailscale IP and its matching hostname in the profile:

```json
{
  "workflow": "none",
  "autoOpenBrowser": false,
  "curatorRemote": {
    "host": "your-server.your-tailnet.ts.net",
    "bind": "100.101.102.103"
  }
}
```

Replace both example addresses. Open the URL from the command notification or tool update in your browser. The curator uses its own short-lived HTTP port; it is not served through Forgerie's web address. Your tailnet access rules must allow that port. Do not use `curatorRemote: true` on a server unless you intend to bind all network interfaces.

The curator has a secret URL token, not Forgerie authentication or TLS. Bind only the intended private interface and keep the URL secret. Source inspection confirms this remote path; end-to-end curator use on the physical Tailscale client has not been validated. Keep `workflow: "none"` if you do not need this separate surface.

## Updating the bundle

Keep the dependency exact and unpatched. Update the pin, run `npm run verify`, and run `npm run smoke:package-install` on Node 24. The opt-in check `WEB_ACCESS_REAL=1 ./scripts/web-access-real.ts` uses a temporary profile and Forgerie's hosted runtime to search through keyless Exa and fetch a public page. It does not change the live daemon or profile.
