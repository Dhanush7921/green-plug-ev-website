// Vehicle-to-connector compatibility. Unknown or unverified specifications are an explicit third state,
// never a green "compatible" tick.
export type CompatState = 'COMPATIBLE_VERIFIED' | 'NEEDS_CONFIRMATION' | 'INCOMPATIBLE' | 'OUT_OF_SERVICE';
export type VehicleSpec = { connectors: string[]; maxAcKw: number | null; maxDcKw: number | null; evidenceState: 'verified' | 'unverified' };
export type ConnectorSpec = { standard: string; currentType: 'AC' | 'DC'; maxPowerKw: number; status: string };

export function evaluate(v: VehicleSpec | null, c: ConnectorSpec, stationOperational = true) {
  const reasons: string[] = [];
  if (!stationOperational || c.status !== 'AVAILABLE') return { state: 'OUT_OF_SERVICE' as CompatState, reasons: ['Charger is not in service.'], effectiveKwCeiling: null };
  if (!v) return { state: 'NEEDS_CONFIRMATION' as CompatState, reasons: ['Add your vehicle to check compatibility.'], effectiveKwCeiling: c.maxPowerKw };
  if (!v.connectors.includes(c.standard)) return { state: 'INCOMPATIBLE' as CompatState, reasons: [`Your vehicle does not list a ${label(c.standard)} inlet.`], effectiveKwCeiling: null };
  const vehicleKw = c.currentType === 'AC' ? v.maxAcKw : v.maxDcKw;
  let ceiling: number | null = c.maxPowerKw;
  if (vehicleKw) ceiling = Math.min(vehicleKw, c.maxPowerKw);
  else reasons.push(`Your vehicle's maximum ${c.currentType} charging power is not verified; the charger maximum is shown as an upper limit.`);
  if (v.evidenceState !== 'verified') {
    reasons.push('Vehicle specifications come from an unverified catalogue entry. Confirm with your vehicle manual.');
    return { state: 'NEEDS_CONFIRMATION' as CompatState, reasons, effectiveKwCeiling: ceiling };
  }
  if (!vehicleKw) return { state: 'NEEDS_CONFIRMATION' as CompatState, reasons, effectiveKwCeiling: ceiling };
  return { state: 'COMPATIBLE_VERIFIED' as CompatState, reasons, effectiveKwCeiling: ceiling };
}

/** Conservative charging-time range. Returns null when the power ceiling is unknown. */
export function timeEstimate(plannedKwh: number, ceilingKw: number | null, currentType: 'AC' | 'DC') {
  if (!ceilingKw) return { minMinutes: null, maxMinutes: null, disclaimer: 'Charging time not verified for this vehicle.' };
  const ideal = (plannedKwh / ceilingKw) * 60;
  const lossFactor = currentType === 'AC' ? 1.1 : 1.05;
  const slowFactor = currentType === 'AC' ? 1.25 : 1.6; // DC tapers as the battery fills
  return {
    minMinutes: Math.ceil(ideal * lossFactor),
    maxMinutes: Math.ceil(ideal * slowFactor),
    disclaimer: 'Estimate only. Real time depends on state of charge, battery temperature and charger sharing.',
  };
}

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
export const CONNECTORS = Object.keys(CONNECTOR_LABELS) as readonly string[];
export const label = (s: string) => CONNECTOR_LABELS[s] || s;
