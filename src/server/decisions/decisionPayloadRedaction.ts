const REDACTED = "[redacted]";
const shellWord = String.raw`(?:"(?:\\.|[^"\\])*"|'[^']*'|\\[\s\S]|[^\s"'\\;|&<>])+`;
const quotedValue = String.raw`(?:"(?:\\.|[^"\\])*"|'[^']*')`;
const secretName = (name: string): boolean => {
  const normalized = name.replace(/[-_]/gu, "");
  return /^(?:key|auth)$/iu.test(normalized)
    || /(?:password|passwd|passphrase|token|secret|secretkey|apikey|accesskey(?:id)?|privatekey|credentials?|authorization|cookie)$/iu.test(normalized);
};
function redactedWord(value: string): string {
  const quote = value[0];
  return (quote === "'" || quote === '"') && value.endsWith(quote) ? `${quote}${REDACTED}${quote}` : REDACTED;
}
function redactedHeader(prefix: string, value: string): string {
  const scheme = /authorization[ \t]*:/iu.test(prefix) ? /^(?:bearer|basic)[ \t]+/iu.exec(value)?.[0] ?? "" : "";
  return prefix + scheme + REDACTED;
}
function looksOpaque(value: string): boolean {
  // Git object ids are useful classification context, not credentials by themselves.
  if (value.startsWith("/")) return false;
  if (/^(?:[a-f\d]{40}|[a-f\d]{64})$/iu.test(value) || !/[a-z]/iu.test(value)) return false;
  if (!/[A-Z\d]/u.test(value) && /[-_/]/u.test(value)) return false;
  const counts = new Map<string, number>();
  for (const char of value) counts.set(char, (counts.get(char) ?? 0) + 1);
  let entropy = 0;
  for (const count of counts.values()) { const probability = count / value.length; entropy -= probability * Math.log2(probability); }
  return entropy >= 4;
}

/** Best-effort outbound scrubbing, not a shell parser or a promise that every secret is detected.
 * Keep verbs, flags, field names, URLs and ordinary configuration readable for classification.
 */
export function redactDecisionText(text: string): string {
  const credentials = /\bcurl(?:\s|$)/u.test(text)
    ? text.replace(new RegExp(`((?:^|\\s)(?:--user(?:=|\\s+)|-u(?:\\s*)))(${shellWord})`, "gu"), (_match: string, prefix: string, value: string) => prefix + redactedWord(value))
    : text;
  return credentials
    .replace(/(\b[a-z][a-z\d+.-]*:\/\/)[^\s/"'<>]*@/giu, `$1${REDACTED}@`)
    .replace(/(["'])((?:authorization|proxy-authorization|x-api-key|x-auth-token|cookie|set-cookie)[ \t]*:[ \t]*)((?:\\.|(?!\1)[^\r\n\\])*)\1/giu,
      (_match: string, quote: string, prefix: string, value: string) => quote + redactedHeader(prefix, value) + quote)
    // Unquoted HTTP header values run to end of line, including spaces and
    // quoted Digest parameters. Do not re-match inside a quoted shell header.
    .replace(/(?<![\w"'-])(\b(?:authorization|proxy-authorization|x-api-key|x-auth-token|cookie|set-cookie)[ \t]*:[ \t]*)([^\r\n]+)/giu,
      (_match: string, prefix: string, value: string) => redactedHeader(prefix, value))
    .replace(new RegExp(`(--([\\w-]+)(?:=|\\s+))(${shellWord})`, "gu"), (match: string, prefix: string, name: string, value: string) => secretName(name) ? prefix + redactedWord(value) : match)
    .replace(new RegExp(`(\\b([A-Za-z_][\\w]*)=)(${shellWord})`, "gu"), (match: string, prefix: string, name: string, value: string) => secretName(name) ? prefix + redactedWord(value) : match)
    .replace(new RegExp(`((["'])([\\w-]+)\\2\\s*:\\s*)(${quotedValue})`, "gu"), (match: string, prefix: string, _quote: string, name: string, value: string) => secretName(name) ? prefix + redactedWord(value) : match)
    .replace(/\b(?:sk-[A-Za-z\d_-]{12,}|gh[pousr]_[A-Za-z\d_]{12,}|github_pat_[A-Za-z\d_]{12,}|xox[a-z]-[A-Za-z\d-]{8,}|(?:AKIA|ASIA)[A-Z\d]{16})\b/gu, REDACTED)
    .replace(/[A-Za-z\d_+./-]{32,}={0,2}/gu, value => looksOpaque(value) ? REDACTED : value);
}

/** Serialize a scrubbed copy. Saved gate arguments and executed commands stay exact. */
export function redactDecisionArguments(args: unknown): string {
  return JSON.stringify(args, (key, value: unknown) => secretName(key) ? REDACTED : typeof value === "string" ? redactDecisionText(value) : value);
}
