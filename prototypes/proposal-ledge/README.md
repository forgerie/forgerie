# The ledge: proposals and the queue at the input bar

A mockup. When the agent proposes something (a backlog suggestion to File
or File and act, or a workflow to Review), the proposal collects at the
bottom of the chat in a short summary, so it stays in reach after the thread
scrolls away. Pi's queue moves into the same place and gets the same look.
Nothing here ships yet.

Open `board.html` to see every scene at three sizes, live. Open
`index.html?scene=<name>` for one scene at the window size. Run
`./render.sh light` or `./render.sh dark` to capture the four Fold 8 postures
into `shots/` (ignored by Git). `./render-tiny.sh` captures a 320 × 568 phone,
and `./sheet.sh light <scene>` joins one scene's four postures into one image.

| Scene | What it shows |
|---|---|
| `today` | The backlog card in the thread, and today's boxed queue cards. |
| `one` | One backlog suggestion (a GitHub issue). |
| `one-workflow` | One workflow proposal. |
| `many` | Three proposals, folded into a stack. |
| `many-open` | Three proposals, open. |
| `lots-open` | Nine proposals, open: the list scrolls inside its budget. |
| `queue-one` | One queued message. |
| `queue` | Three queued messages, one of them long. |
| `both` | Three proposals, folded, and two queued messages. |
| `both-open` | The same, open. |
| `menu` | More, open. |
| `states` | Filing, failed with Retry, a workflow just started, a title with no break points. |

## The shape

The ledge grows out of the input bar's top edge. It uses the bar's surface
and the bar's edge colour. It sits inside the bar's rounded corners and meets
the bar with two small inner curves. It has no bottom edge, so it reads as one
object pulled up out of the bar, not as a card that sits on top of it. When the
bar takes focus, the ledge's edge darkens with it.

## Rules the mockup follows

- **One proposal** shows its kind, its title, one line about it, and its
  actions. A backlog suggestion has File and File and act. A workflow has
  Review. More holds the rest: File and act on another model, Show the full
  card in the chat, and Dismiss.
- **Two or more** fold into a stack. The newest proposal is in front with its
  own actions, so the next thing to do needs no extra press. The edges of two
  more show behind it, never more than two, so a stack of 3 and a stack of 30
  have the same height. The count in front opens the list.
- **The open list** is newest first, one line per proposal. Every row keeps
  its own action. The actions are outlined there, so that no row is louder
  than another; a folded stack and a single proposal keep the one filled
  button.
- **The title is a press.** It shows the full card, so the long text is always
  one press away. In the thread, the card becomes one quiet line that says the
  proposal waits at the input, as the pinned dock does today.
- **The queue sits nearest the bar,** below the proposals, because it is the
  bar's own work. It is quieter than a proposal and has no per-item action,
  because Pi can only clear the whole queue. Each line shows the start of the
  message; a press shows all of it.
- **Kinds are words**, in the code font: `Issue`, `Backlog`, `Workflow`,
  `Steer`, `Follow-up`. A workflow's kind is in the live tone, as its card is.

## Layout

Layout depends only on the space, through container queries. Every threshold
is a guess until it is measured on the device.

| Space | Layout |
|---|---|
| Ledge 30rem wide or more | Kind and title on one line. File, File and act, and More inline. |
| Ledge under 30rem wide | The kind moves above the title, and the title wraps to two lines. File moves into More. |
| Ledge under 20rem wide | The words take the whole row. The count and the actions wrap under them. |
| Window under 30rem tall | The line about a single proposal goes, and the stack shows one edge, not two. |
| Open list | At most 40% of the window's height (34% under 30rem tall), then it scrolls with a fade. |
| Queue | At most 22% of the window's height, then it scrolls. |

More opens at window level, above its button, so a scrolled list never clips
it.

## Not in the mockup yet

- Motion: how the ledge arrives, and how a row leaves after File and act.
- Questions, workflow stops and gated approvals. They stay in the pinned dock
  above the bar for now. One of the next questions is whether they move into
  the ledge too.
- Where the full card opens: in place of the quiet line in the thread, or in a
  sheet over it.
