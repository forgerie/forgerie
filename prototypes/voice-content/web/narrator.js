// PROTOTYPE narrator policy: the rules that keep speech from becoming dictation.
//
// Speech runs at about 2.5 words per second. A working agent emits content far
// faster than that, so the narrator must drop and merge instead of queueing
// everything. These rules are the thing the prototype is testing.

export const ACT_PRIORITY = {
  progress: 1,
  orient: 2,
  signpost: 2,
  land: 3,
  decision: 3,
  reply: 3,
};

export const DEFAULT_LIMITS = {
  queued: 2,
  maxWords: 30,
  staleMs: 7000,
  overlapWarn: 0.4,
};

const STOP_WORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "but", "by", "for", "from", "has", "have", "i", "in",
  "is", "it", "its", "of", "on", "or", "that", "the", "then", "this", "to", "was", "we", "will",
  "with", "you", "your", "so", "if", "not", "can", "now",
]);

const UNSPEAKABLE = [
  { name: "path", test: /(^|\s)[\w.-]*\/[\w./-]+/ },
  { name: "filename", test: /\b[\w-]+\.(ts|js|py|json|md|css|html|tsx|rs)\b/ },
  { name: "identifier", test: /\b[a-z]+[A-Z][A-Za-z]*\b/ },
  { name: "long number", test: /\b\d{4,}\b/ },
  { name: "symbol", test: /[{}<>|=]/ },
];

export function words(text) {
  return String(text ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((word) => word.length > 0);
}

export function contentWords(text) {
  return words(text).filter((word) => !STOP_WORDS.has(word));
}

/** Share of the spoken line that also appears in the on-screen block. 1 means dictation. */
export function overlap(spoken, screen) {
  const spokenWords = new Set(contentWords(spoken));
  if (spokenWords.size === 0) return 0;
  const screenWords = new Set(contentWords(screen));
  let shared = 0;
  for (const word of spokenWords) if (screenWords.has(word)) shared += 1;
  return shared / spokenWords.size;
}

export function unspeakable(text) {
  return UNSPEAKABLE.filter((rule) => rule.test.test(String(text ?? ""))).map((rule) => rule.name);
}

export function createNarrator({ limits = {}, now = () => performance.now() } = {}) {
  const policy = { ...DEFAULT_LIMITS, ...limits };
  const queue = [];
  const log = [];
  const stats = { offered: 0, spoken: 0, merged: 0, dropped: 0, violations: 0 };
  let counter = 0;
  let last;

  function record(act, status, detail) {
    log.push({ at: now(), act, status, detail });
    if (log.length > 200) log.shift();
  }

  function inspect(act) {
    const issues = [];
    const wordCount = words(act.text).length;
    if (wordCount > policy.maxWords) issues.push(`${wordCount} words`);
    for (const offender of unspeakable(act.text)) issues.push(`speaks a ${offender}`);
    const ratio = act.screenText === undefined ? 0 : overlap(act.text, act.screenText);
    if (ratio > policy.overlapWarn) issues.push(`${Math.round(ratio * 100)}% overlap with the screen`);
    return { issues, wordCount, ratio };
  }

  return {
    policy,
    stats,
    log,
    get pending() {
      return queue.length;
    },
    get last() {
      return last;
    },
    offer(input) {
      const act = {
        id: `act-${(counter += 1)}`,
        type: input.type ?? "orient",
        text: input.text ?? "",
        refers: input.refers,
        mergeKey: input.mergeKey,
        mergedText: input.mergedText,
        screenText: input.screenText,
        count: 1,
        queuedAt: now(),
      };
      if (act.text.length === 0) return { status: "empty", act };
      stats.offered += 1;
      act.review = inspect(act);

      if (act.mergeKey !== undefined) {
        const sibling = queue.find((queued) => queued.mergeKey === act.mergeKey);
        if (sibling !== undefined) {
          sibling.count += 1;
          sibling.refers = act.refers;
          if (act.mergedText !== undefined) {
            sibling.text = act.mergedText.replace("{n}", spellCount(sibling.count));
            sibling.review = inspect(sibling);
          }
          stats.merged += 1;
          record(sibling, "merged");
          return { status: "merged", act: sibling };
        }
      }

      queue.push(act);
      record(act, "queued");
      if (queue.length <= policy.queued) return { status: "queued", act };

      const priority = (entry) => ACT_PRIORITY[entry.type] ?? 1;
      const weakest = queue.reduce((worst, entry) => (priority(entry) < priority(worst) ? entry : worst), queue[0]);
      queue.splice(queue.indexOf(weakest), 1);
      stats.dropped += 1;
      record(weakest, "dropped", "queue full");
      return { status: weakest === act ? "dropped" : "queued", act };
    },
    /** Jump the queue: used for direct answers to the user. */
    interrupt(input) {
      queue.length = 0;
      return this.offer(input);
    },
    take() {
      while (queue.length > 0) {
        const act = queue.shift();
        const stale = now() - act.queuedAt > policy.staleMs;
        if (stale && (ACT_PRIORITY[act.type] ?? 1) < 3) {
          stats.dropped += 1;
          record(act, "dropped", "stale");
          continue;
        }
        stats.spoken += 1;
        // Rule breaks are counted for what is actually said. An offer that the
        // queue merges or drops never reaches the user's ear.
        if ((act.review?.issues.length ?? 0) > 0) stats.violations += 1;
        record(act, "spoken");
        last = act;
        return act;
      }
      return undefined;
    },
    peek() {
      return queue[0];
    },
    clear() {
      for (const act of queue.splice(0)) record(act, "dropped", "cleared");
    },
  };
}

const NUMBER_WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];

export function spellCount(count) {
  return NUMBER_WORDS[count] ?? String(count);
}
