import { Icon, type IconName } from '../../components/Icon';

const FEATURES: { icon: IconName; title: string; text: string }[] = [
  { icon: 'plug-zap', title: 'Compatibility first', text: 'Tell the app your vehicle once. Options are meant to be filtered by connector and power level, so a scooter rider is not sent to a CCS2-only station.' },
  { icon: 'calendar-clock', title: 'Availability details', text: 'Opening hours, access notes and, where hosts or operators share it, whether a charger is likely free, shown with how recent the information is.' },
  { icon: 'calculator', title: 'Estimated time and cost', text: 'A rough charging time and price before you travel, worked out from charger power, your vehicle and the posted rate. Always marked as an estimate.' },
  { icon: 'route', title: 'Fallback options', text: 'If your first choice is busy or out of service, nearby alternatives that also fit your vehicle, so one closed gate does not end the trip.' },
  { icon: 'house', title: 'Private hosts, by invitation', text: 'Homes, shops and offices with suitable equipment could offer charging on their own terms, after the planned checks.' },
  { icon: 'message-circle', title: 'Quick reports', text: 'A tap to say a charger worked, was busy or was broken, so the next driver sees fresher information.' },
];

export function Features() {
  return (
    <section className="section features" aria-labelledby="features-title">
      <div className="container">
        <div className="section-head">
          <span className="kicker">What the app is planned to do</span>
          <h2 className="h1" id="features-title" data-kinetic>
            Less guessing at the plug.
          </h2>
          <p className="lede" data-scan>
            Everything below describes features in design. None of them are live yet, and we will say clearly when each one is.
          </p>
        </div>
        <div className="feature-grid" data-depth-panels>
          {FEATURES.map((f, i) => (
            <article className="card feature" key={f.title} data-gloss data-tilt="5">
              <span className="feature-no" aria-hidden="true">
                {String(i + 1).padStart(2, '0')}
              </span>
              <span className="icon-tile">
                <Icon name={f.icon} />
              </span>
              <h3 className="h3">{f.title}</h3>
              <p>{f.text}</p>
              <span className="badge">Planned</span>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
