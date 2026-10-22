import { ButtonLink } from '../components/Button';

export function NotFound() {
  return (
    <section className="section notfound">
      <div className="container stack" style={{ justifyItems: 'start', paddingTop: 'calc(var(--nav-h) + 40px)' }}>
        <span className="kicker">404</span>
        <h1 className="h1">This page is not plugged in.</h1>
        <p className="lede">The address may be mistyped, or the page may have moved.</p>
        <ButtonLink to="/" icon="arrow-right">
          Back to home
        </ButtonLink>
      </div>
    </section>
  );
}
