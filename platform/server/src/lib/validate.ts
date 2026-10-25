// Small, explicit validators. Every handler validates its input before touching the database.
import { badRequest } from './errors';

type Obj = Record<string, unknown>;
export function obj(v: unknown): Obj {
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw badRequest('Request body must be a JSON object.');
  return v as Obj;
}
export function str(o: Obj, k: string, opts: { min?: number; max?: number; optional?: boolean; pattern?: RegExp; label?: string } = {}): string {
  const v = o[k];
  const label = opts.label || k;
  if (v === undefined || v === null || v === '') {
    if (opts.optional) return '';
    throw badRequest(`${label} is required.`, { field: k });
  }
  if (typeof v !== 'string') throw badRequest(`${label} must be text.`, { field: k });
  const s = v.trim();
  if (s.length < (opts.min ?? (opts.optional ? 0 : 1))) throw badRequest(`${label} is too short.`, { field: k });
  if (s.length > (opts.max ?? 200)) throw badRequest(`${label} is too long (max ${opts.max ?? 200}).`, { field: k });
  if (opts.pattern && s && !opts.pattern.test(s)) throw badRequest(`${label} has an invalid format.`, { field: k });
  return s;
}
export function num(o: Obj, k: string, opts: { min?: number; max?: number; optional?: boolean; int?: boolean; label?: string } = {}): number {
  const v = o[k];
  const label = opts.label || k;
  if (v === undefined || v === null || v === '') {
    if (opts.optional) return NaN;
    throw badRequest(`${label} is required.`, { field: k });
  }
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
  if (!Number.isFinite(n)) throw badRequest(`${label} must be a number.`, { field: k });
  if (opts.int && !Number.isInteger(n)) throw badRequest(`${label} must be a whole number.`, { field: k });
  if (opts.min !== undefined && n < opts.min) throw badRequest(`${label} must be at least ${opts.min}.`, { field: k });
  if (opts.max !== undefined && n > opts.max) throw badRequest(`${label} must be at most ${opts.max}.`, { field: k });
  return n;
}
export function oneOf<T extends string>(o: Obj, k: string, values: readonly T[], opts: { optional?: boolean; label?: string } = {}): T {
  const v = o[k];
  if ((v === undefined || v === null || v === '') && opts.optional) return '' as T;
  if (typeof v !== 'string' || !values.includes(v as T)) throw badRequest(`${opts.label || k} must be one of: ${values.join(', ')}.`, { field: k });
  return v as T;
}
export function bool(o: Obj, k: string, d = false): boolean {
  const v = o[k];
  if (v === undefined || v === null) return d;
  if (typeof v !== 'boolean') throw badRequest(`${k} must be true or false.`, { field: k });
  return v;
}
export function arr<T extends string>(o: Obj, k: string, values: readonly T[], opts: { min?: number; max?: number } = {}): T[] {
  const v = o[k] ?? [];
  if (!Array.isArray(v)) throw badRequest(`${k} must be a list.`, { field: k });
  if (v.length < (opts.min ?? 0)) throw badRequest(`Choose at least ${opts.min} ${k}.`, { field: k });
  if (v.length > (opts.max ?? 20)) throw badRequest(`Too many ${k}.`, { field: k });
  for (const x of v) if (typeof x !== 'string' || !values.includes(x as T)) throw badRequest(`Invalid value in ${k}.`, { field: k });
  return [...new Set(v as T[])];
}
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function uuid(v: unknown, label = 'id'): string {
  if (typeof v !== 'string' || !UUID.test(v)) throw badRequest(`${label} is not a valid identifier.`);
  return v.toLowerCase();
}
export const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
export const PHONE = /^\+?[0-9 ]{8,16}$/;
export const DATE = /^\d{4}-\d{2}-\d{2}$/;
export const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
