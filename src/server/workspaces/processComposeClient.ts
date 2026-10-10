import { request } from "node:http";
import { readFile } from "node:fs/promises";
import { Type } from "typebox";
import { Check } from "typebox/value";
import type { WorkspaceServiceProcess, WorkspaceServicesLogs } from "../../shared/workspaceServices.js";
import type { WorkspaceServicesRecord } from "./workspaceServicesStore.js";

const processSchema = Type.Object({ name: Type.String({ minLength: 1 }), status: Type.String(), is_ready: Type.String(), has_ready_probe: Type.Boolean(), restarts: Type.Integer({ minimum: 0 }), exit_code: Type.Integer() });
const logsSchema = Type.Object({ logs: Type.Array(Type.String()) });
const MAX_RESPONSE_BYTES = 1024 * 1024;

/** Process Compose 1.120.0 REST contract. Never exposes its control token to API clients. */
export class ProcessComposeClient {
  async processes(record: WorkspaceServicesRecord, signal?: AbortSignal): Promise<WorkspaceServiceProcess[]> {
    const value = await this.call(record, "GET", "/processes", 3000, signal);
    if (!Check(Type.Object({ data: Type.Array(processSchema) }), value)) throw new Error("Invalid Process Compose process response");
    return value.data.map((item) => ({ name: item.name, kind: processKind(item.status, item.has_ready_probe ? item.is_ready : "", item.exit_code), restarts: item.restarts, exitCode: item.exit_code }));
  }
  async logs(record: WorkspaceServicesRecord, name: string, lines: number): Promise<WorkspaceServicesLogs> {
    const value = await this.call(record, "GET", `/process/logs/${encodeURIComponent(name)}/0/${String(lines)}`);
    if (!Check(logsSchema, value)) throw new Error("Invalid Process Compose logs response");
    const text = Buffer.from(value.logs.join("\n"), "utf8");
    let start = Math.max(0, text.length - 32 * 1024);
    // Drop a partial UTF-8 character at the truncation boundary, without exceeding the byte budget.
    while (((text[start] ?? 0) & 0xc0) === 0x80) start++;
    const bounded = text.subarray(start).toString("utf8");
    return { logs: bounded.split("\n").slice(-lines), truncated: start !== 0 || value.logs.length > lines };
  }
  async control(record: WorkspaceServicesRecord, action: "start" | "stop" | "restart", service: string): Promise<void> {
    await this.call(record, action === "stop" ? "PATCH" : "POST", `/process/${action}/${encodeURIComponent(service)}`, 30_000);
  }
  async stop(record: WorkspaceServicesRecord): Promise<void> { await this.call(record, "POST", "/project/stop", 30_000); }
  private async call(record: WorkspaceServicesRecord, method: string, path: string, timeoutMs = 3000, signal?: AbortSignal): Promise<unknown> {
    const token = (await readFile(record.tokenFile, { encoding: "utf8", signal })).trim();
    return new Promise((resolve, reject) => {
      const req = request({ socketPath: record.socket, agent: false, signal, method, path, headers: { "X-PC-Token-Key": token }, timeout: timeoutMs }, (res) => {
        let size = 0;
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size > MAX_RESPONSE_BYTES) { req.destroy(new Error("Process Compose response exceeded 1 MiB")); return; }
          chunks.push(chunk);
        });
        res.on("error", reject);
        res.on("end", () => {
          if (res.statusCode !== 200) { reject(new Error(`Process Compose returned HTTP ${String(res.statusCode)}`)); return; }
          try { const value: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8")); resolve(value); } catch (error) { reject(error instanceof Error ? error : new Error(String(error))); }
        });
      });
      req.on("timeout", () => { req.destroy(new Error("Process Compose request timed out")); });
      req.on("error", reject);
      req.end();
    });
  }
}

function processKind(status: string, readiness: string, code: number): WorkspaceServiceProcess["kind"] {
  if (status === "Pending" || status === "Launching") return "waiting";
  if (status === "Running") return readiness === "Ready" ? "ready" : readiness === "Not Ready" ? "starting" : "running";
  if (status === "Completed") return code === 0 ? "completed" : "failed";
  if (status === "Disabled" || status === "Stopped") return "stopped";
  if (status === "Restarting") return "starting";
  if (status === "Error") return "failed";
  return "unknown";
}
