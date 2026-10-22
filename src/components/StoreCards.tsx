import { stores } from '../config/site';
import { Link } from '../lib/router';
import { Icon } from './Icon';

/** Original store glyphs (not the official badges): a play prism and a phone-with-plug mark. */
function PlayGlyph() {
  return (
    <svg viewBox="0 0 48 48" aria-hidden="true" className="store-glyph">
      <path d="M12 7.5 38.5 22.3a2 2 0 0 1 0 3.4L12 40.5a2 2 0 0 1-3-1.7V9.2a2 2 0 0 1 3-1.7Z" fill="none" stroke="currentColor" strokeWidth="3" strokeLinejoin="round" />
      <path d="M9.5 9 27 24 9.5 39" fill="none" stroke="currentColor" strokeWidth="2" opacity=".55" />
    </svg>
  );
}
function PhoneGlyph() {
  return (
    <svg viewBox="0 0 48 48" aria-hidden="true" className="store-glyph">
      <rect x="13" y="5" width="22" height="38" rx="5.5" fill="none" stroke="currentColor" strokeWidth="3" />
      <path d="M21 9.5h6" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
      <path d="m25.5 17-5 8h4.5l-2 7 5.5-8.5H24l1.5-6.5Z" fill="currentColor" />
    </svg>
  );
}

export function StoreCards() {
  const items = [
    { key: 'play', ...stores.play, platform: 'Android', Glyph: PlayGlyph },
    { key: 'apple', ...stores.apple, platform: 'iPhone', Glyph: PhoneGlyph },
  ];
  return (
    <div className="store-cards">
      {items.map(({ key, label, url, platform, Glyph }) => {
        const live = !!url;
        const body = (
          <>
            <Glyph />
            <span className="store-text">
              <small>{live ? 'Get it on' : 'Coming soon to'}</small>
              <strong>{label}</strong>
              <span className="store-meta">{live ? `For ${platform}` : `${platform} app in development`}</span>
            </span>
            <span className={`store-state${live ? ' is-live' : ''}`}>{live ? <Icon name="arrow-up-right" /> : 'Soon'}</span>
          </>
        );
        return live ? (
          <a key={key} className="store-card glass" href={url} target="_blank" rel="noopener noreferrer" data-gloss data-tilt="6" data-magnetic="0.12">
            {body}
          </a>
        ) : (
          <div key={key} className="store-card glass is-soon" data-gloss data-tilt="6" role="group" aria-label={`${label}: coming soon. The ${platform} app is not published yet.`}>
            {body}
          </div>
        );
      })}
      <p className="store-note muted">
        Neither app is published yet. <Link to="/contact?form=driver" className="text-link">Join early access</Link> and we will tell you when the listings go live.
      </p>
    </div>
  );
}
