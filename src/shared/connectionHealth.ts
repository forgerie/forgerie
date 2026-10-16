import { z } from "zod";

const probeId = z.string().min(1).max(64);
export const connectionPingSchema = z.object({ type: z.literal("connection.ping"), id: probeId });
export const connectionPongSchema = z.object({ type: z.literal("connection.pong"), id: probeId });
