// Bookings are stored in UTC and shown in the station's timezone. This phase supports Asia/Kolkata (UTC+05:30, no DST).
export const IST_OFFSET_MIN = 330;

export function istDateTimeToUtc(date: string, hhmm: string) {
  return new Date(`${date}T${hhmm}:00+05:30`);
}
export function istParts(d: Date) {
  const t = new Date(d.getTime() + IST_OFFSET_MIN * 60_000);
  return { date: t.toISOString().slice(0, 10), time: t.toISOString().slice(11, 16), weekday: t.getUTCDay(), minutes: t.getUTCHours() * 60 + t.getUTCMinutes() };
}
export function todayIst() {
  return istParts(new Date()).date;
}
export const toMinutes = (t: string) => {
  const [h, m] = t.slice(0, 5).split(':').map(Number);
  return h * 60 + m;
};
export const fromMinutes = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
/** closes_at 00:00 means midnight (end of day) */
export const closeMinutes = (t: string) => (toMinutes(t) === 0 ? 1440 : toMinutes(t));
