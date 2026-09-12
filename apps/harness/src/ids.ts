import { randomUUID } from "node:crypto";

export const newId = (): string => randomUUID();
export const now = (): string => new Date().toISOString();
