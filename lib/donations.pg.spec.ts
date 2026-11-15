import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { GET, POST } from "../app/api/donations/route";

const { startFakeDoor } = await import(new URL("../scripts/fake-door.mjs", import.meta.url).href);

import type { User } from "./accounts";
import { csv, parseCsv } from "./csv";
import * as kit from "./donations";
import { database } from "./runtime";

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
process.env.APP_ORIGIN = "http://127.0.0.1:3542";
process.env.SESSION_SECRET = "local-disposable-donations-test-secret-only";
process.env.PRAMAAN_PAYMENTS_TEST_MODE = "true";
process.env.PRAMAAN_MODULES_DIR = `/tmp/donation-test-${process.pid}`;
let door: any;
let campaign: string;
let a: User;
let b: User;
let owner: User;
let staff: User;
const db = database();
const body = (value: object) =>
  new Request(`${process.env.APP_ORIGIN}/api/donations`, {
    method: "POST",
    headers: { origin: process.env.APP_ORIGIN!, "content-type": "application/json" },
    body: JSON.stringify(value),
  });
async function user(role: string, email: string) {
  const u = { id: randomUUID(), email, role };
  await db.query("INSERT INTO app_users(id,email,password_hash,role) VALUES($1,$2,$3,$4)", [
    u.id,
    email,
    "unused-fixture",
    role,
  ]);
  return u;
}
async function give(u: User | null = a, monthly = false, anonymous = false) {
  const id = randomUUID();
  const token = "a".repeat(64);
  const result = await kit.createGiving(u, {
    requestId: id,
    campaignId: campaign,
    amount: 2500,
    status: "confirmed",
    paid: true,
    monthly,
    anonymous,
    guestToken: token,
    name: "Guest name",
    email: "guest@example.test",
  });
  return { id, token, result };
}
async function pay(id: string) {
  const r = await kit.scoped(owner, id);
  if (r.monthly) {
    const s = door.subscriptions.get(r.billing_ref);
    s.status = "active";
    s.paid = true;
  } else {
    const s = door.checkouts.get(r.checkout_ref);
    s.status = "paid";
    s.payments = [
      { ref: `capture_${id}`, status: "captured", amount: { amount: 2500, currency: "GBP" } },
    ];
  }
}
beforeAll(async () => {
  door = await startFakeDoor({
    dir: process.env.PRAMAAN_MODULES_DIR,
    port: 3542,
    origin: process.env.APP_ORIGIN,
  });
});
beforeEach(async () => {
  await db.query(
    "TRUNCATE app_users,donors,giving_requests,gifts,receipts,receipt_counters CASCADE",
  );
  door.keys.clear();
  door.fingerprints.clear();
  door.checkouts.clear();
  door.subscriptions.clear();
  door.mail.length = 0;
  door.on = true;
  door.emailOn = true;
  process.env.PRAMAAN_PAYMENTS_TEST_MODE = "true";
  campaign = (await db.query("SELECT id FROM campaigns LIMIT 1")).rows[0].id;
  await db.query("UPDATE campaigns SET open=true");
  a = await user("donor", "a@example.test");
  b = await user("donor", "b@example.test");
  owner = await user("owner", "owner@example.test");
  staff = await user("staff", "staff@example.test");
  for (const u of [a, b]) {
    const d = await kit.donor(u);
    await db.query("UPDATE donors SET phone='9000000000' WHERE id=$1", [d.id]);
  }
});
afterAll(async () => {
  await door.close();
  await db.end();
});
describe("gift confirmation and isolation", () => {
  it("counts no pending gift, ignores browser paid status and issues one receipt under concurrent reads", async () => {
    const g = await give();
    expect((await kit.campaigns())[0].raised).toBe(0);
    await kit.billing(a, g.id, "refresh");
    expect((await kit.mine(a)).gifts).toHaveLength(0);
    await pay(g.id);
    await Promise.all([kit.billing(a, g.id, "refresh"), kit.billing(a, g.id, "refresh")]);
    expect((await kit.mine(a)).gifts).toHaveLength(1);
    expect((await db.query("SELECT * FROM receipts")).rowCount).toBe(1);
    expect((await kit.campaigns())[0].raised).toBe(2500);
    expect(door.mail).toHaveLength(1);
  });
  it("gives as a guest with a random proof and never links by email", async () => {
    const g = await give(null);
    await expect(kit.scoped(null, g.id)).rejects.toMatchObject({ status: 404 });
    await expect(kit.scoped(b, g.id)).rejects.toMatchObject({ status: 404 });
    await pay(g.id);
    await kit.billing(null, g.id, "refresh", g.token);
    await kit.billing(null, g.id, "refresh", g.token);
    expect((await db.query("SELECT * FROM receipts")).rowCount).toBe(1);
    expect((await kit.mine(a)).gifts).toHaveLength(0);
  });
  it("monthly active state alone is not a paid gift; transaction read twice gives one receipt", async () => {
    const g = await give(a, true);
    const r = await kit.scoped(a, g.id);
    door.subscriptions.get(r.billing_ref).status = "active";
    await kit.billing(a, g.id, "refresh");
    expect((await kit.mine(a)).gifts).toHaveLength(0);
    await pay(g.id);
    await kit.billing(a, g.id, "refresh");
    await kit.billing(a, g.id, "refresh");
    expect((await kit.mine(a)).gifts).toHaveLength(1);
    await kit.billing(a, g.id, "pause");
    expect((await kit.scoped(a, g.id)).status).toBe("paused");
    await kit.billing(a, g.id, "cancel");
    expect((await kit.scoped(a, g.id)).status).toBe("cancel_scheduled");
  });
  it("rejects foreign reads and mutations and staff billing", async () => {
    const g = await give();
    await expect(kit.scoped(b, g.id)).rejects.toMatchObject({ status: 404 });
    await expect(kit.billing(b, g.id, "cancel")).rejects.toMatchObject({ status: 404 });
    await expect(kit.billing(staff, g.id, "refresh")).rejects.toMatchObject({ status: 403 });
  });
  it("refuses wrong amounts, currency and authorization-only payments", async () => {
    const g = await give();
    await pay(g.id);
    const r = await kit.scoped(a, g.id);
    const p = door.checkouts.get(r.checkout_ref).payments[0];
    p.amount.amount = 1;
    await kit.billing(a, g.id, "refresh");
    p.amount.amount = 2500;
    p.amount.currency = "USD";
    await kit.billing(a, g.id, "refresh");
    p.amount.currency = "GBP";
    p.status = "authorized";
    await kit.billing(a, g.id, "refresh");
    expect((await kit.mine(a)).gifts).toHaveLength(0);
  });
  it("checks subscription identity and exact terms", async () => {
    const g = await give(a, true);
    const r = await kit.scoped(a, g.id);
    const s = door.subscriptions.get(r.billing_ref);
    s.recurringAmount.amount = 1;
    await expect(kit.billing(a, g.id, "refresh")).rejects.toMatchObject({ status: 502 });
    expect((await kit.mine(a)).gifts).toHaveLength(0);
  });
  it("preserves attempt keys over unavailable modules and refuses stale creates", async () => {
    const id = randomUUID();
    const input = { requestId: id, campaignId: campaign, amount: 2500 };
    door.on = false;
    await expect(kit.createGiving(a, input)).rejects.toMatchObject({ status: 503 });
    door.on = true;
    await kit.createGiving(a, input);
    const before = door.checkouts.size;
    await kit.createGiving(a, input);
    expect(door.checkouts.size).toBe(before);
    await db.query(
      "UPDATE giving_requests SET checkout_ref=NULL,created_at=now()-interval '2 days' WHERE id=$1",
      [id],
    );
    await expect(kit.billing(a, id, "start")).rejects.toMatchObject({ status: 409 });
  });
  it("fails closed when test payments are off", async () => {
    process.env.PRAMAAN_PAYMENTS_TEST_MODE = "false";
    await expect(give()).rejects.toMatchObject({ status: 503 });
    expect((await kit.campaigns())[0].raised).toBe(0);
  });
  it("anonymous public gifts hide name but staff keep identity", async () => {
    const g = await give(a, false, true);
    await pay(g.id);
    await kit.billing(a, g.id, "refresh");
    expect((await kit.publicDetails(campaign)).gifts[0].name).toBe("Anonymous");
    expect((await kit.scoped(owner, g.id)).email).toBe(a.email);
  });
  it("closed campaigns and guest monthly are refused", async () => {
    await db.query("UPDATE campaigns SET open=false");
    await expect(give()).rejects.toMatchObject({ status: 409 });
    await expect(give(null, true)).rejects.toMatchObject({ status: 401 });
  });
  it("keeps queued receipts when email is off and retries only once", async () => {
    door.emailOn = false;
    const g = await give();
    await pay(g.id);
    await kit.billing(a, g.id, "refresh");
    expect((await db.query("SELECT email_status FROM receipts")).rows[0].email_status).toBe(
      "not-sent",
    );
    door.emailOn = true;
    await kit.deliverEmails();
    await kit.deliverEmails();
    expect(door.mail).toHaveLength(1);
  });
  it("numbers confirmed gifts uniquely and sequentially per year", async () => {
    for (const u of [a, b]) {
      const g = await give(u);
      await pay(g.id);
      await kit.billing(u, g.id, "refresh");
    }
    expect(
      (await db.query("SELECT number FROM receipts ORDER BY number")).rows.map((r) => r.number),
    ).toEqual([1, 2]);
  });
  it("refuses replaying one capture against another giving request", async () => {
    const g = await give(a);
    await pay(g.id);
    await kit.billing(a, g.id, "refresh");
    const h = await give(b);
    await pay(h.id);
    const r = await kit.scoped(b, h.id);
    door.checkouts.get(r.checkout_ref).payments[0].ref = `capture_${g.id}`;
    await expect(kit.billing(b, h.id, "refresh")).rejects.toMatchObject({ status: 502 });
    expect((await kit.mine(b)).gifts).toHaveLength(0);
  });
  it("adding staff with an email that already has an account says so and changes nothing", async () => {
    await expect(
      kit.addStaff(owner, { email: "a@example.test", password: "a-long-staff-password" }),
    ).rejects.toMatchObject({ status: 409 });
    expect((await db.query("SELECT role FROM app_users WHERE id=$1", [a.id])).rows[0].role).toBe(
      "donor",
    );
  });
  it("CSV protects formulas and preserves quoted fields", () => {
    expect(csv([["  =SUM(1,2)"]])).toContain('"\'  =SUM(1,2)"');
    expect(csv([["=SUM(1,2)", "+x", "@x", "-x"]])).toContain('"\'=SUM(1,2)"');
    expect(parseCsv('name,email\n"A, B",x@example.test')).toEqual([
      ["name", "email"],
      ["A, B", "x@example.test"],
    ]);
  });
  it("HTTP refuses forged identity, wrong origin and oversize body", async () => {
    expect(
      (
        await GET(
          new Request(`${process.env.APP_ORIGIN}/api/donations?view=settings`, {
            headers: { "x-app-user": owner.id },
          }),
        )
      ).status,
    ).toBe(401);
    const req = body({ action: "give" });
    req.headers.set("origin", "https://other.test");
    expect((await POST(req)).status).toBe(403);
    expect((await POST(body({ action: "give", name: "x".repeat(17000) }))).status).toBe(413);
  });
});
