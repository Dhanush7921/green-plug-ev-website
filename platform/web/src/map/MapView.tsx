// Map adapter: a real provider (Google Maps JS API) when configured, otherwise the interactive demo map.
import { useState } from 'react';
import { useSession } from '../lib/session';
import { DemoMap } from './DemoMap';
import { GoogleMap } from './GoogleMap';
import type { MapProps } from './types';
export type { MapPoint } from './types';

export function MapView(props: MapProps) {
  const { config } = useSession();
  const [failed, setFailed] = useState(false);
  if (config?.maps.provider === 'google' && config.maps.browserKey && !failed) return <GoogleMap {...props} browserKey={config.maps.browserKey} onFail={() => setFailed(true)} />;
  return <DemoMap {...props} />;
}
