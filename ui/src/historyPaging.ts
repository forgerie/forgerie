/** The store owns this state; Thread only presents it and delegates to the runtime. */
export type EarlierHistory =
  | { type: "complete" }
  | { type: "available" }
  | { type: "loading" }
  | { type: "failed"; message: string };
