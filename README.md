# Donations

Community fundraising with public campaigns, guest gifts, signed-in monthly giving, staff management and numbered receipts.

Use Node 24.18.0 and pnpm 11.15.1. Install with `pnpm install --frozen-lockfile --ignore-scripts --ignore-pnpmfile`. Configure DATABASE_URL, SESSION_SECRET (at least 32 characters), APP_ORIGIN and PRAMAAN_PROJECT_ID. Local HTTP needs APP_COOKIE_SECURE=false. Run `node scripts/migrate.mjs`, `CIRCLE_NODE_TOTAL=2 NODE_OPTIONS=--max-old-space-size=768 pnpm build`, then `pnpm start --port 3540`.

Open as owner through the platform owner pass. Staff are added in owner settings and sign in at /signin; donors can sign up there. Payments require PRAMAAN_PAYMENTS_TEST_MODE=true and test credentials connected by the platform operator. Email and files say plainly when unavailable. No external service keys belong in this app.

Tests: use a disposable migrated TEST_DATABASE_URL and run pnpm test. Browser checks: a fresh migrated DATABASE_URL and node scripts/walk.mjs; only ports 3540–3544 and headless Chromium are used. See KIT.md for the code map and GAPS.md for boundaries.

MIT. Starter account and theme code is credited in NOTICE.md.

The kit carries no browser tools. To run `node scripts/walk.mjs`, install `@playwright/test` 1.64.1 outside the kit and set `WALK_BROWSER_MODULE` to its `index.mjs`.
