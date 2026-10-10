import Fastify from "fastify";
import { describe, expect, it } from "vitest";
import { registerChildRunRoutes } from "./childRunRoutes.js";
import type { ChildRunFilter } from "../../shared/childRuns.js";

describe("child run history API", () => {
  it("passes exact combined filters and returns retention with the records", async () => {
    const app = Fastify();
    const filters: ChildRunFilter[] = [];
    registerChildRunRoutes(app, { list: (filter) => { filters.push(filter ?? {}); return Promise.resolve([]); } }, "/api");
    try {
      const response = await app.inject("/api/sessions/children/runs?session=parent&agent=worker");
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ retentionDays: 90, records: [] });
      expect(filters).toEqual([{ session: "parent", agent: "worker" }]);
      expect((await app.inject("/api/sessions/children/runs")).statusCode).toBe(200);
      expect(filters[1]).toEqual({});
    } finally { await app.close(); }
  });
  it("rejects empty, repeated, and unknown filters without reading history", async () => {
    const app = Fastify(); let reads = 0;
    registerChildRunRoutes(app, { list: () => { reads++; return Promise.resolve([]); } });
    try {
      for (const query of ["session=", "agent=", "session=a&session=b", "limit=3", "cwd=/repo"]) {
        expect((await app.inject(`/sessions/children/runs?${query}`)).statusCode).toBe(400);
      }
      expect(reads).toBe(0);
    } finally { await app.close(); }
  });
  it("returns a read failure instead of an empty successful history", async () => {
    const app = Fastify();
    registerChildRunRoutes(app, { list: () => Promise.reject(new Error("Invalid child run file")) });
    try {
      const response = await app.inject("/sessions/children/runs");
      expect(response.statusCode).toBe(500);
      expect(response.json()).toEqual({ error: "Invalid child run file" });
    } finally { await app.close(); }
  });
});
