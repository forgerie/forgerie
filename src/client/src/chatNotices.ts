/**
 * Splitting for system notices rendered in the transcript.
 *
 * The transcript states a failure as a short lead phrase carrying the signal,
 * followed by the raw detail in plain ink. Colouring the whole line reads as
 * the system shouting, however restrained the wording is, so only the lead
 * takes the danger tone.
 *
 * Server text arrives as one string, conventionally "<lead>: <detail>". When it
 * does not follow that shape there is no honest lead to promote, and the whole
 * string stays plain.
 */

export interface ChatNotice {
  /** Short phrase carrying the failure signal. Empty when none was found. */
  readonly lead: string;
  /** The remaining text, rendered in plain ink. */
  readonly detail: string;
}

/** Longest lead we will promote. Beyond this the "lead" is really a sentence. */
const MAX_LEAD_LENGTH = 48;

export function splitChatNotice(text: string): ChatNotice {
  const trimmed = text.trim();
  const separator = trimmed.indexOf(": ");
  if (separator <= 0) return { lead: "", detail: trimmed };

  const lead = trimmed.slice(0, separator).trim();
  const detail = trimmed.slice(separator + 2).trim();
  if (lead === "" || detail === "" || lead.length > MAX_LEAD_LENGTH) {
    return { lead: "", detail: trimmed };
  }

  // A lead spanning sentences is prose, not a signal phrase.
  if (lead.includes(". ")) return { lead: "", detail: trimmed };

  return { lead: `${lead}.`, detail };
}
