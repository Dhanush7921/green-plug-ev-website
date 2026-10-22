import { useRef } from 'react';
import { useMotion } from '../motion/kinetic';
import { AppPreview } from '../sections/home/AppPreview';
import { Benefits } from '../sections/home/Benefits';
import { Cinema } from '../sections/home/Cinema';
import { Features } from '../sections/home/Features';
import { StoreSection } from '../sections/home/StoreSection';

export function Home() {
  const ref = useRef<HTMLDivElement>(null);
  useMotion(ref);
  return (
    <div className="page page-home" ref={ref}>
      <Cinema />
      <Features />
      <Benefits />
      <AppPreview />
      <StoreSection />
    </div>
  );
}
