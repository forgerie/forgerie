/** A declared label wins; older files fall back to readable words, without changing their input keys. */
export function workflowInputLabel(name: string, description?: string): string {
  if (description?.trim()) return description.trim();
  const words = name.replace(/([a-z0-9])([A-Z])/gu, "$1 $2").replace(/[_-]+/gu, " ").toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}
