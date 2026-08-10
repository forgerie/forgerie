const SESSION_CATALOG_FIRST_MESSAGE_MAX_CODE_POINTS = 500;

/** Bound the display fallback without splitting Unicode surrogate pairs. */
export function boundSessionCatalogFirstMessage(firstMessage: string): string {
  return Array.from(firstMessage).slice(0, SESSION_CATALOG_FIRST_MESSAGE_MAX_CODE_POINTS).join("");
}
