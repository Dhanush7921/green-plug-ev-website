// Frontend lead capture. Sends JSON to a Google Apps Script web app (see apps-script/Code.gs).
// Without VITE_LEADS_ENDPOINT the site runs in demo mode and never claims data was saved.
import { site } from '../config/site';

export type LeadType = 'general' | 'driver' | 'host' | 'partner';
export type LeadData = Record<string, string | boolean>;
export type SubmitResult =
  | { status: 'saved' }
  | { status: 'demo'; payload: unknown }
  | { status: 'duplicate' }
  | { status: 'error'; message: string };

export const leadsMode: 'live' | 'demo' = site.leadsEndpoint ? 'live' : 'demo';
const SENT_KEY = 'gpev-sent-v1';
const DAY = 24 * 60 * 60 * 1000;

function fnv1a(str: string) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

function fingerprint(type: LeadType, data: LeadData) {
  const norm = Object.keys(data)
    .filter((k) => k !== 'consent' && k !== 'website')
    .sort()
    .map((k) => `${k}=${String(data[k]).trim().toLowerCase().replace(/\s+/g, ' ')}`)
    .join('&');
  return fnv1a(`${type}|${norm}`);
}

function readSent(): Record<string, number> {
  try {
    const raw = localStorage.getItem(SENT_KEY);
    const map = raw ? (JSON.parse(raw) as Record<string, number>) : {};
    const now = Date.now();
    for (const k of Object.keys(map)) if (now - map[k] > DAY) delete map[k];
    return map;
  } catch {
    return {};
  }
}

function markSent(fp: string) {
  try {
    const map = readSent();
    map[fp] = Date.now();
    localStorage.setItem(SENT_KEY, JSON.stringify(map));
  } catch {
    /* storage unavailable: server-side duplicate check still applies */
  }
}

export function newSubmissionId() {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

export async function submitLead(type: LeadType, data: LeadData, submissionId: string): Promise<SubmitResult> {
  if (data.website) return { status: 'error', message: 'This submission was blocked by our spam filter. If you are a person, clear the hidden "website" field or contact us another way.' };
  const fp = fingerprint(type, data);
  if (readSent()[fp]) return { status: 'duplicate' };

  const clean = Object.fromEntries(Object.entries(data).filter(([k]) => k !== 'website'));
  const payload = { type, submissionId, submittedAt: new Date().toISOString(), page: window.location.pathname, data: clean };

  if (!site.leadsEndpoint) return { status: 'demo', payload };

  const ctrl = new AbortController();
  const timer = window.setTimeout(() => ctrl.abort(), 15000);
  try {
    // text/plain avoids a CORS preflight, which Apps Script web apps do not answer.
    const res = await fetch(site.leadsEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(payload),
      signal: ctrl.signal,
      redirect: 'follow',
    });
    let json: { ok?: boolean; duplicate?: boolean; error?: string } | null = null;
    try {
      json = await res.json();
    } catch {
      return { status: 'error', message: `The form service sent an unexpected response (HTTP ${res.status}). Your details were not saved.` };
    }
    if (json?.duplicate) {
      markSent(fp);
      return { status: 'duplicate' };
    }
    if (!res.ok || !json?.ok) return { status: 'error', message: json?.error ? `The form service rejected the submission: ${json.error}` : `The form service returned an error (HTTP ${res.status}). Your details were not saved.` };
    markSent(fp);
    return { status: 'saved' };
  } catch (e) {
    const aborted = (e as Error).name === 'AbortError';
    return { status: 'error', message: aborted ? 'The form service took too long to respond. Your details were not saved — please try again.' : 'We could not reach the form service. Check your connection and try again — your details were not saved.' };
  } finally {
    window.clearTimeout(timer);
  }
}
