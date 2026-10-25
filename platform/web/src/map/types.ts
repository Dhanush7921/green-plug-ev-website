export type MapPoint = {
  id: string;
  lat: number;
  lng: number;
  label?: string; // short text on the pin, e.g. price
  title: string; // accessible name
  tone?: 'good' | 'warn' | 'bad' | 'neutral';
  approximate?: boolean; // private/home listing: location is deliberately approximate
};
export type MapProps = {
  points: MapPoint[];
  path?: [number, number][];
  selectedId?: string | null;
  onSelect?: (id: string) => void;
  /** pick mode: clicking the map reports coordinates */
  pick?: { lat: number; lng: number } | null;
  onPick?: (lat: number, lng: number) => void;
  height?: number | string;
  label?: string;
};
