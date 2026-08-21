// PROTOTYPE audio helper.
//
// Chrome returns a promise from AudioContext.resume() that never settles when
// the page has no user gesture yet. Awaiting it directly stalls whatever holds
// it. Always resume with a deadline and then read the state.

export async function resumeContext(context, timeoutMs = 200) {
  if (context.state === "running") return true;
  void context.resume().catch(() => undefined);
  await new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer);
      context.removeEventListener("statechange", done);
      resolve();
    };
    const timer = setTimeout(done, timeoutMs);
    context.addEventListener("statechange", done);
  });
  return context.state === "running";
}
