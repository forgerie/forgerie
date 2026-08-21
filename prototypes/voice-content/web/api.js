// PROTOTYPE. Thin fetch layer over the local speech process.

export class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

export async function getStatus() {
  const response = await fetch("/api/status", { cache: "no-store" });
  if (!response.ok) throw new ApiError("status failed", response.status);
  return response.json();
}

export async function synthesize(text, voice = "af_bella", signal) {
  const response = await fetch("/api/tts", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text, voice }),
    signal,
  });
  if (!response.ok) throw new ApiError(await errorText(response), response.status);
  return response.arrayBuffer();
}

export async function transcribe(samples, signal) {
  const response = await fetch("/api/stt", {
    method: "POST",
    headers: { "content-type": "application/octet-stream" },
    body: encodePcm(samples),
    signal,
  });
  if (!response.ok) throw new ApiError(await errorText(response), response.status);
  const value = await response.json();
  return typeof value.text === "string" ? value.text : "";
}

export async function checkTurn(samples, signal) {
  const response = await fetch("/api/check-turn", {
    method: "POST",
    headers: { "content-type": "application/octet-stream" },
    body: encodePcm(samples),
    signal,
  });
  if (!response.ok) throw new ApiError(await errorText(response), response.status);
  return response.json();
}

function encodePcm(samples) {
  const bytes = new Uint8Array(samples.length * 4);
  const view = new DataView(bytes.buffer);
  for (let index = 0; index < samples.length; index += 1) {
    view.setFloat32(index * 4, samples[index] ?? 0, true);
  }
  return bytes;
}

async function errorText(response) {
  const body = await response.json().catch(() => undefined);
  return body?.error ?? `request failed with ${response.status}`;
}
