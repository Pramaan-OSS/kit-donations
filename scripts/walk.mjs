import { execFileSync, spawn } from "node:child_process";
import { createHmac, randomBytes } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

// The kit carries the starter's package.json, which has no browser tools: point WALK_BROWSER_MODULE at an installed
// @playwright/test (its index.mjs) to run this walk.
const browserModule = process.env.WALK_BROWSER_MODULE;
const { chromium, expect } = await import(
  browserModule ? pathToFileURL(browserModule).href : "@playwright/test"
);

import { Pool } from "pg";
import { startFakeDoor } from "./fake-door.mjs";

const origin = "http://127.0.0.1:3540";
const secret = randomBytes(32).toString("hex");
const project = "donations-walk";
if (!process.env.DATABASE_URL) throw Error("Use a disposable migrated DATABASE_URL");
const db = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
const dir = path.resolve(".scratch/walk-door");
mkdirSync(".evidence", { recursive: true });
const door = await startFakeDoor({ dir, port: 3541 });
const server = spawn(
  process.execPath,
  ["node_modules/next/dist/bin/next", "start", "-H", "127.0.0.1", "-p", "3540"],
  {
    stdio: ["ignore", "ignore", "inherit"],
    env: {
      ...process.env,
      SESSION_SECRET: secret,
      PRAMAAN_PROJECT_ID: project,
      APP_ORIGIN: origin,
      APP_COOKIE_SECURE: "false",
      PRAMAAN_MODULES_DIR: dir,
      PRAMAAN_PAYMENTS_TEST_MODE: "true",
    },
  },
);
let peakMiB = 0;
const sampler = setInterval(() => {
  try {
    const rows = execFileSync("ps", ["-A", "-o", "pid=,ppid=,rss="], { encoding: "utf8" })
      .trim()
      .split("\n")
      .map((l) => l.trim().split(/\s+/).map(Number));
    const tree = new Set([server.pid]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const [pid, ppid] of rows)
        if (tree.has(ppid) && !tree.has(pid)) {
          tree.add(pid);
          changed = true;
        }
    }
    peakMiB = Math.max(
      peakMiB,
      Math.ceil(rows.filter((r) => tree.has(r[0])).reduce((n, r) => n + r[2], 0) / 1024),
    );
  } catch {}
}, 100);
let browser;
let checks = 0;
const verify = async (test) => {
  await test();
  checks++;
};
function pass() {
  const now = Math.floor(Date.now() / 1000);
  const body = Buffer.from(
    JSON.stringify({
      v: 1,
      role: "owner",
      project,
      iat: now,
      exp: now + 60,
      nonce: randomBytes(18).toString("base64url"),
    }),
  ).toString("base64url");
  return `${body}.${createHmac("sha256", secret).update(`pramaan-owner-pass.v1.${body}`).digest("base64url")}`;
}
try {
  await db.query(
    "UPDATE campaign_categories SET name='Community' WHERE id=(SELECT category_id FROM campaigns WHERE title='A place for everyone' LIMIT 1)",
  );
  await db.query(
    "TRUNCATE app_users,donors,giving_requests,gifts,receipts,receipt_counters CASCADE",
  );
  for (let n = 0; n < 100; n++) {
    try {
      if ((await fetch(origin + "/api/health")).ok) break;
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  browser = await chromium.launch({ headless: true });
  const owner = await browser.newContext(),
    donor = await browser.newContext(),
    staff = await browser.newContext(),
    other = await browser.newContext(),
    guest = await browser.newContext();
  const o = await owner.newPage(),
    d = await donor.newPage(),
    s = await staff.newPage(),
    b = await other.newPage(),
    g = await guest.newPage();
  const api = (ctx, input) =>
    ctx.request.post(origin + "/api/donations", { headers: { origin }, data: input });
  const token = pass();
  await o.goto(origin + "/api/account/owner-pass?token=" + encodeURIComponent(token));
  await verify(() => expect(o.getByRole("heading", { name: "Owner area" })).toBeVisible());
  await verify(async () =>
    expect(
      (
        await guest.request.get(
          origin + "/api/account/owner-pass?token=" + encodeURIComponent(token),
          { maxRedirects: 0 },
        )
      ).status(),
    ).toBe(401),
  );
  await o.getByLabel("Owner email").fill("owner-walk@example.test");
  await o.getByLabel("Password", { exact: true }).fill("owner-walk-strong-password");
  await o.getByRole("button", { name: "Save sign-in" }).click();
  await verify(() => expect(o.getByText("Saved. You can now sign in")).toBeVisible());
  await o.goto(origin + "/settings");
  await o.getByLabel("Staff email").fill("staff-walk@example.test");
  await o.getByLabel("Temporary password").fill("staff-walk-strong-password");
  await o.getByRole("button", { name: "Add staff", exact: true }).click();
  await verify(() => expect(o.getByText("Staff account added.")).toBeVisible());
  await s.goto(origin + "/signin");
  const signin = s
    .locator("section")
    .filter({ has: s.getByRole("heading", { name: "Sign in", exact: true }) });
  await signin.getByLabel("Email", { exact: true }).fill("staff-walk@example.test");
  await signin.getByLabel("Password", { exact: true }).fill("staff-walk-strong-password");
  await signin.getByRole("button", { name: "Sign in", exact: true }).click();
  await s.waitForURL("**/giving");
  async function signup(page, name) {
    await page.goto(origin + "/signin");
    const f = page
      .locator("section")
      .filter({ has: page.getByRole("heading", { name: "Become a donor" }) });
    await f.getByLabel("Your name").fill(name);
    await f.getByLabel("Phone number").fill("9000000000");
    await f.getByLabel("Email", { exact: true }).fill(name + "@example.test");
    await f.getByLabel("Password", { exact: true }).fill("donor-walk-strong-password");
    await f.getByRole("button", { name: "Create account" }).click();
    await page.waitForURL("**/giving");
  }
  await signup(d, "donor-walk");
  await signup(b, "other-walk");
  const manifest = JSON.parse(
    await (await import("node:fs/promises")).readFile("pramaan.kit.json", "utf8"),
  );
  for (const j of manifest.journeys.filter((j) => j.status === "ships-working")) {
    const checklist = JSON.parse(
      await (await import("node:fs/promises")).readFile(j.checklist, "utf8"),
    );
    const page = j.role === "owner" ? o : j.role === "donor" ? d : g;
    for (const item of checklist.items)
      for (const step of item.steps) {
        if (step.goto) await page.goto(origin + step.goto);
        if (step.expectHeading)
          await verify(() =>
            expect(
              page.getByRole("heading", { name: step.expectHeading, exact: false }),
            ).toBeVisible(),
          );
      }
    console.log(`journey:${j.id}: passed`);
  }
  await g.goto(origin + "/");
  await g.getByRole("link", { name: "View campaign →" }).first().click();
  await g.getByLabel("Your name").fill("Guest Walker");
  await g.getByLabel("Email", { exact: true }).fill("guest-walk@example.test");
  await g.getByLabel("Hide my name publicly").check();
  await g.getByRole("button", { name: "Continue to test payment" }).click();
  await g.waitForURL("http://127.0.0.1:3541/**");
  await verify(async () =>
    expect(
      (await (await guest.request.get(origin + "/api/donations?view=campaigns")).json())
        .campaigns[0].raised,
    ).toBe(0),
  );
  await g.getByRole("button", { name: "Confirm test payment" }).click();
  await g.waitForURL("**/thanks?**");
  await g.getByRole("button", { name: "Check payment and receipt" }).click();
  await verify(() => expect(g.getByText(/Receipt \d{4}-1/)).toBeVisible());
  await g.getByRole("button", { name: "Check payment and receipt" }).click();
  await verify(async () => expect((await db.query("SELECT * FROM receipts")).rowCount).toBe(1));
  const guestRequest = (
    await db.query("SELECT id FROM giving_requests WHERE guest_hash IS NOT NULL")
  ).rows[0].id;
  await verify(async () =>
    expect(
      (await other.request.get(origin + "/api/donations?view=record&id=" + guestRequest)).status(),
    ).toBe(404),
  );
  await verify(async () =>
    expect(
      (await guest.request.get(origin + "/api/donations?view=guest&id=" + guestRequest)).status(),
    ).toBe(404),
  );
  await d.goto(origin + "/");
  await d.getByRole("link", { name: "View campaign →" }).first().click();
  await d.getByLabel("Your name").fill("Donor Walker");
  await d.getByLabel("Email", { exact: true }).fill("donor-walk@example.test");
  await d.getByLabel("Give monthly").check();
  await d.getByRole("button", { name: "Continue to test payment" }).click();
  await d.waitForURL("http://127.0.0.1:3541/**");
  await d.getByRole("button", { name: "Confirm test payment" }).click();
  await d.waitForURL("**/giving");
  await d.getByRole("button", { name: "Check payment", exact: true }).click();
  await verify(() => expect(d.getByText(/Receipt \d{4}-2/)).toBeVisible());
  await d.getByRole("button", { name: "Check payment", exact: true }).click();
  await verify(async () => expect((await db.query("SELECT * FROM receipts")).rowCount).toBe(2));
  const record = (await (await donor.request.get(origin + "/api/donations")).json()).requests[0];
  await verify(async () =>
    expect(
      (await other.request.get(origin + "/api/donations?view=record&id=" + record.id)).status(),
    ).toBe(404),
  );
  await verify(async () =>
    expect((await api(other, { action: "cancel", id: record.id })).status()).toBe(404),
  );
  await verify(async () =>
    expect((await api(staff, { action: "cancel", id: record.id })).status()).toBe(403),
  );
  await verify(async () =>
    expect((await staff.request.get(origin + "/api/donations?view=settings")).status()).toBe(403),
  );
  await verify(async () => expect((await api(staff, { action: "staff" })).status()).toBe(403));
  await verify(async () =>
    expect((await guest.request.get(origin + "/api/donations")).status()).toBe(401),
  );
  const ownGift = (await (await donor.request.get(origin + "/api/donations")).json()).gifts[0].id;
  await verify(async () =>
    expect(
      (await other.request.get(origin + "/api/donations?view=gift&id=" + ownGift)).status(),
    ).toBe(404),
  );
  await verify(async () =>
    expect(
      (await donor.request.get(origin + "/api/donations?view=gift&id=" + ownGift)).status(),
    ).toBe(200),
  );
  await d.getByRole("button", { name: "Pause monthly giving" }).click();
  await verify(() => expect(d.getByText("£25.00 · Monthly · paused")).toBeVisible());
  await d.getByRole("button", { name: "Cancel at period end" }).click();
  await verify(() => expect(d.getByText("£25.00 · Monthly · cancel scheduled")).toBeVisible());
  await verify(async () =>
    expect(
      (await (await guest.request.get(origin + "/api/donations?view=campaigns")).json())
        .campaigns[0].raised,
    ).toBe(5000),
  );
  const campaign = (await db.query("SELECT id FROM campaigns LIMIT 1")).rows[0].id;
  const publicData = await (
    await guest.request.get(origin + "/api/donations?view=campaign&id=" + campaign)
  ).json();
  await verify(async () => expect(publicData.gifts.some((r) => r.name === "Anonymous")).toBe(true));
  await s.goto(origin + "/manage");
  await verify(() =>
    expect(s.getByLabel("guest-walk@example.test", { exact: true })).toHaveValue("Guest Walker"),
  );
  await s.getByLabel("Campaign update", { exact: true }).fill("The room is taking shape.");
  await s.getByRole("button", { name: "Post update" }).click();
  await verify(() => expect(s.getByText("Saved.", { exact: true }).first()).toBeVisible());
  const importData =
    "reference,campaign,name,email,amount\noffline-walk,A place for everyone,=FORMULA,offline@example.test,1000";
  await s.getByLabel("CSV: reference,campaign,name,email,amount").fill(importData);
  await s.getByRole("button", { name: "Import offline gifts" }).click();
  await verify(() => expect(s.getByText("Offline gifts imported.")).toBeVisible());
  await s.getByRole("button", { name: "Import offline gifts" }).click();
  await verify(async () => expect((await db.query("SELECT * FROM receipts")).rowCount).toBe(3));
  await verify(async () =>
    expect(await (await staff.request.get(origin + "/api/donations?view=export")).text()).toContain(
      "'=FORMULA",
    ),
  );
  await o.goto(origin + "/settings");
  await o.getByLabel("Community", { exact: true }).fill("Neighbourhood");
  await o
    .getByLabel("Neighbourhood", { exact: true })
    .count()
    .catch(() => {});
  await o
    .getByLabel("Community", { exact: true })
    .locator("..")
    .locator("..")
    .getByRole("button", { name: "Rename" })
    .click();
  await verify(() => expect(o.getByLabel("Neighbourhood", { exact: true })).toBeVisible());
  const category = (await db.query("SELECT category_id FROM campaigns LIMIT 1")).rows[0]
    .category_id;
  await verify(async () =>
    expect(
      (await api(owner, { action: "list-delete", kind: "category", id: category })).status(),
    ).toBe(409),
  );
  door.emailOn = false;
  await verify(async () => expect((await api(owner, { action: "emails" })).status()).toBe(200));
  door.emailOn = true;
  await api(owner, { action: "emails" });
  await verify(async () => expect(door.mail.length).toBeGreaterThanOrEqual(3));
  await verify(async () =>
    expect(
      (
        await staff.request.put(origin + "/api/images?id=" + campaign, {
          headers: { origin, "content-type": "image/png" },
          data: Buffer.from("not an image"),
        })
      ).status(),
    ).toBe(400),
  );
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jG7kAAAAASUVORK5CYII=",
    "base64",
  );
  await verify(async () =>
    expect(
      (
        await staff.request.put(origin + "/api/images?id=" + campaign, {
          headers: { origin, "content-type": "image/png" },
          data: png,
        })
      ).status(),
    ).toBe(503),
  );
  door.filesOn = true;
  await verify(async () =>
    expect(
      (
        await staff.request.put(origin + "/api/images?id=" + campaign, {
          headers: { origin, "content-type": "image/png" },
          data: png,
        })
      ).status(),
    ).toBe(200),
  );
  await verify(async () =>
    expect(await (await guest.request.get(origin + "/api/images?id=" + campaign)).body()).toEqual(
      png,
    ),
  );
  await g.goto(origin + "/");
  await g.screenshot({ path: ".evidence/campaigns-desktop.png", fullPage: true });
  await g.setViewportSize({ width: 390, height: 844 });
  await g.screenshot({ path: ".evidence/campaigns-mobile.png", fullPage: true });
  await verify(async () =>
    expect(await g.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
      true,
    ),
  );
  writeFileSync(
    ".evidence/walk.json",
    JSON.stringify(
      {
        ok: true,
        assertions: checks,
        shippingJourneys: manifest.journeys.filter((j) => j.status === "ships-working").length,
        appPeakMiB: peakMiB,
        fixture: "fake platform door; no live calls",
      },
      null,
      2,
    ),
  );
  console.log(`Headless walk passed: ${checks} assertions; app peak ${peakMiB} MiB.`);
} finally {
  clearInterval(sampler);
  await browser?.close();
  server.kill("SIGTERM");
  await new Promise((r) => server.once("exit", r));
  await door.close();
  await db.end();
}
