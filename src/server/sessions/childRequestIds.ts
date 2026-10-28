/**
 * A child reporter admits one input per attempt: attempt 0 is `child:<reporter>`, later attempts add `:retry:<n>`.
 * Legacy single-model children stop at attempt 3; a model chain can go further (wait, switch, wait, switch, then
 * the exhaustion budget). MAX_CHILD_ATTEMPT bounds every attempt and every recovery probe.
 */
export const MAX_CHILD_ATTEMPT = 64;

export function childRequestId(reporter: string | number, attempt: number): string {
  return attempt === 0 ? `child:${String(reporter)}` : `child:${String(reporter)}:retry:${String(attempt)}`;
}

/**
 * The latest admitted request of a reporter. Attempts are not guaranteed to start at 0 (a reporter can begin in a
 * retry phase) and a failed switch can leave a gap, so probe every attempt up to the bound and keep the highest hit.
 */
export async function latestChildRequest<T>(reporter: string | number, lookup: (requestId: string) => Promise<T | undefined>): Promise<T | undefined> {
  let latest: T | undefined;
  for (let attempt = 0; attempt <= MAX_CHILD_ATTEMPT; attempt++) {
    const found = await lookup(childRequestId(reporter, attempt));
    if (found !== undefined) latest = found;
  }
  return latest;
}
