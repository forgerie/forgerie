const SESSION_CATALOG_FIRST_MESSAGE_MAX_CODE_POINTS = 500;

/** Bound the display fallback without splitting Unicode surrogate pairs. */
export function boundSessionCatalogFirstMessage(firstMessage: string): string {
  if (firstMessage.length <= SESSION_CATALOG_FIRST_MESSAGE_MAX_CODE_POINTS) return firstMessage;

  let codePointCount = 0;
  let codeUnitOffset = 0;
  while (codeUnitOffset < firstMessage.length && codePointCount < SESSION_CATALOG_FIRST_MESSAGE_MAX_CODE_POINTS) {
    const codePoint = firstMessage.codePointAt(codeUnitOffset);
    if (codePoint === undefined) break;
    codeUnitOffset += codePoint > 0xffff ? 2 : 1;
    codePointCount += 1;
  }

  return codeUnitOffset === firstMessage.length ? firstMessage : firstMessage.slice(0, codeUnitOffset);
}
