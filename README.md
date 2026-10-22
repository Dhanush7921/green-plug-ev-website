# GREEN PLUG EV website

Informational marketing website for **GREEN PLUG EV**, a planned EV charging discovery app for electric cars and bikes, launching first in Andhra Pradesh, India.
The site explains what the app is intended to do and collects early-access interest. It is not the app: there is no login, booking, payment or live charger data.

## What is inside

- **Seven pages**: Home, How it works, For drivers, For charging hosts, Safety and trust, FAQ, Contact and early access.
- **Brand intro** (about 5 s, once per browser session on the home page, Skip button and Esc, skipped for reduced motion, no audio).
- **3D charging scene** (three.js): a licensed, logo-free concept car, an original charger, CCS2-style connector and inlet, a simulated cable, and a stylised electric scooter. The connector leaves the holster, the inlet door opens, the plug aligns and seats, latches, and charging starts (simulated). Scrolling moves the camera to the scooter, along the energy flow, and up over an illustrative discovery city with filterable pins.
- **Motion**: GSAP timelines and ScrollTrigger with scoped cleanup (`src/lib/gsap.ts`, `src/motion/kinetic.ts`).
- **Pointer system**: glossy cursor, mint light, short trail, magnetic buttons, card tilt and reflections. Off on touch devices, with reduced motion, or via the footer switch.
- **Light and dark themes** from one token file (`src/styles/tokens.css`), persisted in `localStorage`.
- **Forms** for driver early access, host interest, partnerships and general enquiries, with an optional Google Apps Script endpoint (`apps-script/`). Without an endpoint the forms run in a clearly labelled demo mode.
- **WebGL fallback**: an SVG illustration when WebGL is unavailable or the context is lost.

## Project layout

```
src/
  brand/        generated logo paths (scripts/assets/build_logo.py)
  components/   Nav, Footer, Intro, PointerSystem, RouteView, LeadForm, Logo, ...
  config/       site.ts (brand, store links, endpoint), routes.json (titles, descriptions)
  lib/          router, theme, GSAP setup, preferences, lead submission
  motion/       kinetic typography and scroll motion vocabulary
  pages/        one file per page
  sections/home the cinematic stage and home sections
  styles/       tokens, base, components, home, pages
  three/        ChargingScene and its parts (car, charger, connector, cable, scooter, environment)
public/         model, brand SVGs, favicon
scripts/        build, dev server, preview server, asset tools
apps-script/    Google Apps Script endpoint for Google Sheets
```

## Run locally

Requires Node 20+.

```bash
npm install
npm run dev        # http://localhost:5173
npm run typecheck
npm run build      # outputs dist/
npm run preview    # serves dist/ like GitHub Pages, http://localhost:4173
```

The build uses esbuild directly (the same compiler Vite uses) and follows Vite conventions: `VITE_*` variables, `import.meta.env.BASE_URL` and an `index.html` template. One HTML file is written per route so deep links work on GitHub Pages.

Useful URL flags for testing: `?nointro` skips the intro, `?nowebgl` forces the illustration fallback.

## Configuration

Copy `.env.example` to `.env` for local builds, or set **repository variables** in GitHub (Settings → Secrets and variables → Actions → Variables). All `VITE_*` values end up in public JavaScript, so never put secrets in them.

| Variable | Purpose |
| --- | --- |
| `VITE_LEADS_ENDPOINT` | Apps Script web app URL. Empty = demo mode (nothing is sent). |
| `VITE_PLAY_STORE_URL`, `VITE_APP_STORE_URL` | Store listings. Empty = “Coming soon”. Also editable in `src/config/site.ts`. |
| `VITE_CONTACT_EMAIL` | Optional public email on the Contact page. |
| `BASE_PATH` | Set automatically by the deploy workflow (`/green-plug-ev-website/`). |

## Forms and Google Sheets

See the setup notes at the top of `apps-script/Code.gs`. In short: create a Google Sheet, paste the script into Extensions → Apps Script, deploy as a web app (execute as you, access “Anyone”), and put the `/exec` URL in `VITE_LEADS_ENDPOINT`. The script validates every field again, allow-lists options, rejects the honeypot, requires consent, de-duplicates, rate-limits per email and globally, and neutralises spreadsheet formulas. It never returns sheet data.

## Deployment (GitHub Pages)

`.github/workflows/deploy.yml` builds and deploys on every push to `main`. One-time setup in the repository: **Settings → Pages → Build and deployment → Source: GitHub Actions**. The site is then served at `https://<owner>.github.io/green-plug-ev-website/`. No custom domain is configured; when you add one, set the repository variable `BASE_PATH` to `/`.

## Assets and licences

See [ASSETS.md](ASSETS.md). The 3D car is CC BY 4.0 and credited in the footer.

## Honest limitations

- The charger, connector and scooter are original stylised models; the car is a detailed concept-car model. None of them is a specific real product, and the scene is real-time rendering, not photography.
- The connection, charging percentage, map pins, app screens and estimates are simulations or examples and are labelled as such.
- 3D performance depends on the device; the renderer lowers its pixel ratio when frames are slow, pauses when off screen and uses a lighter quality level on phones.
