import { useRef } from 'react';
import { PageHero } from '../components/PageHero';
import { site } from '../config/site';
import { useMotion } from '../motion/kinetic';

const ext = { target: '_blank', rel: 'noopener noreferrer', className: 'text-link' } as const;

export default function Legal() {
  const ref = useRef<HTMLDivElement>(null);
  useMotion(ref);
  return (
    <div className="page" ref={ref}>
      <PageHero kicker="Legal" title="Legal & credits" icon="scale" lede={`Pre-launch notice, third-party credits and licences for the ${site.name} website.`} />
      <section className="section">
        <div className="container legal-body" data-depth-panels>
          <article className="legal-block glass">
            <h2 className="h3">Pre-launch notice</h2>
            <p>
              {site.name} is an app in development. It is not available yet: no stations or hosts are listed, nothing can be booked or paid for, and any app screens, prices, maps or
              locations on this website are illustrative previews.
            </p>
          </article>
          <article className="legal-block glass">
            <h2 className="h3">3D car model</h2>
            <p>
              “Car Concept” © 2024 Darmstadt Graphics Group GmbH (artist Eric Chadwick), based on a CC0 model by Unity Fan, used under{' '}
              <a href="https://creativecommons.org/licenses/by/4.0/" {...ext}>
                Creative Commons Attribution 4.0 (CC BY 4.0)
              </a>
              . Logos removed; materials and parts modified for this website.
            </p>
          </article>
          <article className="legal-block glass">
            <h2 className="h3">Original artwork</h2>
            <p>The charger, scooter, charging connector, cable, city and charging-network graphics, logo and all animations are original work made for {site.name}.</p>
            <p>The intro film is rendered from these 3D scenes, including the “Car Concept” model credited above. Its city map, interface screens and sound design are original. The map, distances, battery readings, prices and booking shown in it are illustrative concept-demo values, not live data.</p>
          </article>
          <article className="legal-block glass">
            <h2 className="h3">Icons and fonts</h2>
            <p>
              Icons:{' '}
              <a href="https://lucide.dev/license" {...ext}>
                Lucide
              </a>{' '}
              (ISC licence). Fonts: Unbounded and Instrument Sans, under the{' '}
              <a href="https://openfontlicense.org/" {...ext}>
                SIL Open Font License 1.1
              </a>
              .
            </p>
          </article>
          <p className="muted small">
            © {new Date().getFullYear()} {site.name}. All rights reserved for original content.
          </p>
        </div>
      </section>
    </div>
  );
}
