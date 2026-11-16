# Donations kit

## Where things live

- app/page.tsx: public campaign list and confirmed progress.
- app/campaign/page.tsx: public story, suggested gifts, updates and giving form.
- app/thanks/page.tsx: guest payment refresh and numbered receipt, using a browser-held proof.
- app/signin/page.tsx: staff, donor and owner sign-in; public donor signup.
- app/giving/page.tsx: own profile, giving requests, receipts, pause and cancellation.
- app/manage/page.tsx: staff campaign editing, updates, images, donors, gifts and CSV.
- app/settings/page.tsx: owner-only staff, new campaigns and editable category/status tables.
- app/owner/page.tsx: owner-pass landing and owner credentials.
- app/api/account/[action]/route.ts: unchanged account actions.
- app/api/donations/route.ts: server access checks and record operations.
- app/api/images/route.ts: public campaign image reads and staff PNG uploads.
- app/api/health/route.ts: unchanged health response.
- app/layout.tsx, app/shell.tsx, app/theme.css: starter layout and app navigation/style.
- lib/accounts.ts: unchanged reviewed accounts implementation.
- lib/runtime.ts: shared bounded database pool and account configuration.
- lib/donations.ts: scoped records, server-owned payment terms, durable attempts, gift confirmation, serialized yearly numbering and receipt email queue.
- lib/pramaan.ts: the single capability client through the platform HTTP door.
- lib/email.ts, lib/storage.ts: platform email and file module transports.
- lib/types.ts, lib/money.ts: shared view types and currency formatting.
- lib/csv.ts: quoted CSV parsing and spreadsheet formula escaping.
- lib/roles/http.ts: same-origin, bounded JSON requests and safe error replies.
- lib/pramaan/client.ts: browser requests to this app.
- src/db/migrations/0001–0004: unchanged starter migrations.
- src/db/migrations/0100-donations.sql: campaign, donor, request, gift, receipt and editable list rows; public donor default role.
- lib/donations.pg.spec.ts: real disposable database tests with fake capabilities.
- scripts/fake-door.mjs, scripts/walk.mjs: fake platform and headless browser checks.
- scripts/check-contract.mjs: local contract, licence, secret and package checks.

## Add a field

Add a numbered migration from 0101 onwards; never edit an applied migration. To add a donor address, add its column, then extend the scoped profile update, the giving form and an isolation test. Never link guest/offline rows to accounts by email alone.

## Add a page

Add app/<name>/page.tsx and its pramaan.feature.json with routes and nav. Protect the route's data on the server with requireUser, requireRole or the existing staff/owner guards. Hiding links is not access control. Update this guide and the relevant journey.

## Add a role

Roles live in app_users.role. Only the owner grants staff through the server; signup always creates a donor using the migration's default. Use requireRole or explicit guards on every new handler. Add tests for the role and for a stranger's records. Never accept a role from the browser.

## Journeys that ship working

campaigns, donor-signup, owner-settings, campaign-desk, my-giving and guest-gift. monthly-gift waits for payments to be switched on (needs-capability); its checklist keeps the sign-up steps so it runs once they are. Run node scripts/walk.mjs against a fresh migrated database; it also executes payment completion, duplicate reads, owner-pass reuse, staff sign-in, permission and isolation checks. Payments use the fake module door in checks. Real deployments require enabled test capabilities. Email and files remain needs-capability until those modules are enabled.
