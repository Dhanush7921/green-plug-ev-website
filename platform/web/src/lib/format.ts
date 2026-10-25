export const rupees = (paise: number | null | undefined) =>
  paise === null || paise === undefined ? '—' : `₹${(paise / 100).toLocaleString('en-IN', { minimumFractionDigits: paise % 100 ? 2 : 0, maximumFractionDigits: 2 })}`;

const IST = 'Asia/Kolkata';
export const dateTime = (d: string | Date) => new Date(d).toLocaleString('en-IN', { timeZone: IST, day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: true });
export const time = (d: string | Date) => new Date(d).toLocaleTimeString('en-IN', { timeZone: IST, hour: '2-digit', minute: '2-digit', hour12: true });
export const day = (d: string | Date) => new Date(d).toLocaleDateString('en-IN', { timeZone: IST, weekday: 'short', day: 'numeric', month: 'short' });
export const isoDateIST = (d: Date = new Date()) => new Date(d.getTime() + 5.5 * 36e5).toISOString().slice(0, 10);
export const addDays = (iso: string, n: number) => new Date(new Date(`${iso}T12:00:00+05:30`).getTime() + n * 864e5 + 5.5 * 36e5).toISOString().slice(0, 10);

export const CONNECTOR_LABELS: Record<string, string> = {
  CCS2: 'CCS2',
  TYPE2: 'Type 2',
  CHADEMO: 'CHAdeMO',
  BHARAT_AC001: 'Bharat AC-001',
  BHARAT_DC001: 'Bharat DC-001',
  TYPE7_LECCS: 'Type 7 (LECCS)',
  TYPE6_LEVDC: 'Type 6 (LEVDC)',
  SOCKET_15A: '15A socket',
};
export const connectorLabel = (s: string) => CONNECTOR_LABELS[s] || s;

export const STATUS_LABELS: Record<string, string> = {
  RESERVED: 'Held — awaiting payment',
  CONFIRMED: 'Confirmed',
  CHECKED_IN: 'Checked in',
  IN_PROGRESS: 'Charging',
  COMPLETED: 'Completed',
  CANCELLED_DRIVER: 'Cancelled by you',
  CANCELLED_PARTNER: 'Cancelled by station',
  EXPIRED: 'Expired',
  PAYMENT_FAILED: 'Payment failed',
  NO_SHOW: 'No-show',
};
export const statusLabel = (s: string, partner = false) => (partner && s === 'CANCELLED_DRIVER' ? 'Cancelled by driver' : partner && s === 'CANCELLED_PARTNER' ? 'Cancelled by you' : STATUS_LABELS[s] || s);
export const statusTone = (s: string) =>
  ['CONFIRMED', 'CHECKED_IN', 'IN_PROGRESS', 'COMPLETED', 'APPROVED', 'AVAILABLE', 'PAID', 'PROCESSED', 'RESOLVED'].includes(s)
    ? 'good'
    : ['RESERVED', 'PENDING', 'SUBMITTED', 'DRAFT', 'IN_PROGRESS_T', 'OPEN', 'PARTIALLY_REFUNDED', 'TEMPORARILY_CLOSED', 'PENDING_INTEGRATION', 'CREATED'].includes(s)
      ? 'warn'
      : ['CANCELLED_DRIVER', 'CANCELLED_PARTNER', 'EXPIRED', 'PAYMENT_FAILED', 'NO_SHOW', 'REJECTED', 'SUSPENDED', 'FAILED', 'UNAVAILABLE', 'OUT_OF_SERVICE', 'REFUNDED'].includes(s)
        ? 'bad'
        : 'neutral';

export const CONFIDENCE_LABELS: Record<string, string> = {
  SIMULATED_DEMO: 'Demo listing · simulated availability',
  HOST_CONFIRMED: 'Host-confirmed status (not live)',
  SCHEDULED_ONLY: 'Opening hours only',
  UNKNOWN: 'Status unknown',
};
export const COMPAT_LABELS: Record<string, string> = {
  COMPATIBLE_VERIFIED: 'Compatible (verified)',
  NEEDS_CONFIRMATION: 'Needs confirmation',
  INCOMPATIBLE: 'Not compatible',
  OUT_OF_SERVICE: 'Out of service',
};
export const AMENITY_LABELS: Record<string, string> = {
  parking: 'Parking',
  restroom: 'Restroom',
  cafe: 'Café',
  wifi: 'Wi-Fi',
  waiting_area: 'Waiting area',
  covered: 'Covered',
  cctv: 'CCTV',
  accessible: 'Accessible',
  two_wheeler_parking: 'Two-wheeler parking',
  security: 'Security',
};
export const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
