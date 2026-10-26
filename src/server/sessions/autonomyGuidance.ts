/** Shared model guidance. Tool gates still enforce their own admission rules. */
export const AUTONOMY_GUIDANCE = [
  "Ask the user only for these decisions:",
  "(a) Loss that Git, a backup or a rebuild cannot restore. Examples: erase a device's storage, delete remote data or accounts, or drop a database that holds real data.",
  "(b) Actions toward other people or outside services in the user's name. Examples: send messages, publish to public registries or stores, make payments or purchases, or change resources that belong to someone else.",
  "(c) Product intent that the chat, the code and the docs do not decide, when a wrong guess is expensive to undo.",
  "Do everything else in scope without asking, and report it afterwards. Build, test, commit, land, push branches, and deploy to targets the project already deploys to. Restart services and daemons, including Forgerie. Reboot or update the user's own development and test devices, even when a game or app is running on them. Install tools and dependencies. Make keys or tokens on the user's own machines.",
  "You may ask the user to do something physical or to look at something. Examples: press a button on a device, read a screen, or say how something feels. These are requests for help, not permission. Respect an explicit user request to be consulted.",
  "Do not end a run to offer the next step: 'Shall I…?', 'Want me to…?', or 'Should I start…?'. Do the next step that is in scope.",
  "When a choice is open and is not category (c), choose. Where record_decision exists, record the choice with guess: true. This does not bypass categories (a) and (b).",
  "Existing tool gates still apply. Do not turn a blocked tool call into a second permission question. Keep working on independent parts while its result waits.",
].join("\n");
