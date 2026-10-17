# Not-found page

Issue #76. An address that matches no page used to fall through to the Worker, which answered `{"error": "not_found"}` as JSON: a raw API error in the browser.

## Decision

- `public/404.html`, served by Workers Static Assets with `not_found_handling = "404-page"`. Every path outside `/api/*` that matches no asset gets this page with a `404` status, straight from the assets layer: the Worker is not invoked.
- `/api/*` keeps `run_worker_first`, so API clients still get the JSON `not_found` error.
- The page has `noindex` and is not in the sitemap.

## Content

Same top bar and footer as the terms page, in the `.legal` column:

- a large N + C signal-flag hoist, decorative (`aria-hidden`). The kicker spells it out in text: "Error 404 · Signal NC: in distress", the international code signal for distress;
- heading "Off the chart";
- one line on what happened, one line for the likely case of a broken invite link (open the invite again or type the room code on the home page);
- a "Back to the game" button to `/`.

No new colours, no new script: `theme-init.js` and `theme.js` give it both themes.

## Tests

- Integration: `/no-such-page` is a `404` HTML page carrying the security headers; `/api/does-not-exist` is still the JSON error.
- E2E: in light and dark, the page shows its heading, passes the WCAG AA scan and links back to the home page.
