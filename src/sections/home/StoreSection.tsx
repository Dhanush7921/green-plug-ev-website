import { StoreCards } from '../../components/StoreCards';

export function StoreSection() {
  return (
    <section className="section store-section" aria-labelledby="store-title">
      <div className="store-glow" data-depth="0.2" aria-hidden="true" />
      <div className="container store-inner">
        <div className="section-head">
          <span className="kicker">Download</span>
          <h2 className="h1" id="store-title" data-kinetic>
            On your phone, when it is ready.
          </h2>
          <p className="lede" data-scan>
            GREEN PLUG EV is planned for Android and iPhone. We are not publishing store links until the apps are real.
          </p>
        </div>
        <StoreCards />
      </div>
    </section>
  );
}
