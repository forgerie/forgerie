import type { PluginSettingsField } from "./types";

/**
 * Read a plugin's declared settings fields from module metadata that the host
 * cannot trust at compile time.
 *
 * A broken declaration throws with the plugin and field named, so registration
 * fails loudly instead of rendering a control nobody can save.
 */
export function readPluginSettingsFields(pluginId: string, value: unknown): PluginSettingsField[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error(`Invalid settings fields for ${pluginId}: ${formatUnknownValue(value)}`);
  const seen = new Set<string>();
  return value.map((field) => readPluginSettingsField(pluginId, field, seen));
}

function readPluginSettingsField(pluginId: string, field: unknown, seen: Set<string>): PluginSettingsField {
  if (!isRecord(field)) throw new Error(`Invalid settings field for ${pluginId}: ${formatUnknownValue(field)}`);
  const id = field["id"];
  const label = field["label"];
  const type = field["type"];
  const description = field["description"];
  const defaultValue = field["default"];
  if (typeof id !== "string" || id === "") throw new Error(`Invalid settings field id for ${pluginId}: ${formatUnknownValue(id)}`);
  if (seen.has(id)) throw new Error(`Duplicate settings field id for ${pluginId}: ${id}`);
  if (type !== "boolean") throw new Error(`Unsupported settings field type for ${pluginId}.${id}: ${formatUnknownValue(type)}`);
  if (typeof label !== "string" || label === "") throw new Error(`Invalid settings field label for ${pluginId}.${id}`);
  if (typeof defaultValue !== "boolean") throw new Error(`Settings field default must be a boolean for ${pluginId}.${id}`);
  if (description !== undefined && typeof description !== "string") throw new Error(`Invalid settings field description for ${pluginId}.${id}`);
  seen.add(id);
  return { id, label, type: "boolean", default: defaultValue, ...(description === undefined ? {} : { description }) };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** A short, readable rendering of an untrusted value for a failure message. */
export function formatUnknownValue(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint" || typeof value === "symbol" || typeof value === "function" || value === null || value === undefined) return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return Object.prototype.toString.call(value);
  }
}
