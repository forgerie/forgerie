# Upstream review

Forgerie does not merge from
[jmfederico/pi-web](https://github.com/jmfederico/pi-web). We review upstream
on request and port what we adopt by hand. `upstream.lock` is the cursor:
every upstream commit up to `reviewedCommit` has been seen and judged.

## Steps

1. Read `reviewedCommit` from `upstream.lock`.
2. Add the remote if it is missing:
   `git remote add upstream https://github.com/jmfederico/pi-web.git`.
   Then `git fetch upstream`.
3. Read `git log --oneline <cursor>..upstream/main` and targeted
   `git diff <cursor>..upstream/main -- <paths>`.
4. Write a digest grouped by relevance, not by commit:
   - **Adopt**: fixes and features we want.
   - **Skip**: work that conflicts with our UX or that we do not want, with the
     reason.
   - **Discuss**: anything unclear. Ask the user before you port it.
5. Port each adopted change against our code. Cherry-pick only when the
   touched files have not diverged. Never resolve a port by reverting our
   divergence.
6. Record the review in `docs/upstream-reviews/YYYY-MM-DD.md`: the range
   reviewed, what was adopted (with our commit SHAs), and what was skipped and
   why. A skip is final unless the user reopens it.
7. Move `upstream.lock` forward to the reviewed commit (`reviewedCommit`,
   `reviewedDescribe`, `reviewedAt`). Move it only at the end of a complete
   review.

## Priorities

- **High**: session daemon, session persistence, reconnect and replay, ask and
  dialog stores, child-agent persistence, security fixes, and
  `@earendil-works/pi-*` version bumps.
- **Low, usually skip**: upstream client UI, styling, and bundled plugin UX.
  Our browser app in `ui/` is a separate design.
