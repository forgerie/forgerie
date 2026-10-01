# Image viewing

The chat shows every renderable image in a session and opens them in one shared viewer. Before this change, the transcript dropped assistant and tool images and showed only user attachments.

This change stays on `new-ui-mvp`. It does not touch `main`, the Lit client, or the backend.

## Behavior

| Source | Where it shows |
|---|---|
| Tool results, such as `read` of a PNG | The reply gallery below the reply's text, and as thumbnails in the expanded tool's Output section. |
| Images the assistant itself returns | The reply gallery. They do not render inline in the text. |
| User attachments | The existing chips. Each chip opens the message's image attachments as one set. |
| Markdown images in replies | Unchanged: still links. Remote and data images in Markdown stay blocked. |

- A reply is one assistant turn. Adjacent assistant messages join into one reply, so one prompt gives one gallery.
- One image shows large, up to 24rem wide. Two or more images show as one row of square tiles.
- `galleryPlan(width, count)` in `src/images.ts` decides the row. Tiles never draw narrower than 96 px. When the images do not fit, the last tile shows "+N" and opens the first hidden image. Every image stays one tap away. There is no breakpoint; the count comes from the gallery's own width.
- The viewer is a native modal `<dialog>` that fills the window. It shows "k of n", the image name, previous/next, zoom out, a reset that shows the zoom percentage, zoom in, and close.
- Input: arrow keys, `+`/`=`/`-`/`0`, Escape, mouse wheel, double-click, pinch, drag to pan when zoomed, and a one-finger horizontal swipe for next/previous. A tap on the empty stage closes. The end of a swipe does not close.
- Only the stage has `touch-action: none`, so a pinch zooms the image and never the page. The pan and zoom math is `src/imageZoomGesture.ts`, ported unchanged from the Lit client.
- Closing by any path returns focus to the control that opened the viewer.
- Supported types: PNG, JPEG, GIF, and WebP with base64 data. Other image parts keep their `[image]` text in tool output and are not drawn.

## Data path

- History: `toolResult` messages keep their image parts. `fromHistory` stores them on the tool's `done` state as data URLs.
- Live: `tool.end` events carry the raw result as `content`. The reducer reads images from it. The persisted `toolResult` that follows describes the same execution and does not duplicate images.
- The first-paint preview projection on the server drops images, but this app loads full history, so images arrive on the first load.

## Checks

Checked on 2026-09-30.

| Check | Result |
|---|---|
| `npm run verify` | Build, TypeScript, ESLint, and 309 tests passed. New tests cover the image model, the gallery plan at each boundary, swipe detection, transcript mapping for history, live events, and assistant images, and the viewer in the real assistant-ui runtime. |
| `scripts/images-acceptance.mjs` | Passed all four Fold postures in both themes with real Chromium input: the gallery stays in one row inside the column with tiles of at least 96 px, the overflow tile opens the right image, wheel and pinch zoom the image while `visualViewport.scale` stays 1, a touch swipe moves to the next image, Escape closes, and focus returns. No API calls. |
| `scripts/image-shots.sh` | Captured the gallery and the open viewer in 16 posture and theme combinations. All were reviewed. |
| `scripts/real-images-check.ts` | Against a real session from 8504: 12 of 12 tool images in the history reached the transcript. |
| `scripts/visual-acceptance.mjs`, `scripts/trace-acceptance.mjs` | Passed with no regressions. |

## Limits

- Live tool images were checked in unit tests and by reading the server code, not with a live model run.
- Physical-device pinch and swipe on the Fold remain unverified.
- Images that arrive while a tool still runs (`tool.update`) are not shown until the tool finishes.
- There is no download or copy action in the viewer.
