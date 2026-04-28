import { randomBytes } from 'node:crypto';

export function createId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${randomBytes(4).toString('hex')}`;
}

export function nowIso(): string {
  return new Date().toISOString();
}
