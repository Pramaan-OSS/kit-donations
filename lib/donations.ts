import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { AccountError, hashPassword, type User } from "./accounts";
import { emailDoor } from "./email";
import { pramaan } from "./pramaan";
import { database } from "./runtime";
export function fail(status: number, message: string): never {
  throw new AccountError(status, message);
}
export function text(v: unknown, max = 120) {
  if (typeof v !== "string" || !v.trim() || v.trim().length > max)
    return fail(400, "Check the submitted information.");
  return v.trim();
}
export function uuid(v: unknown) {
  const s = text(v);
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(s))
    fail(400, "Choose a record.");
  return s;
}
export function amount(v: unknown) {
  const n = Number(v);
  if (!Number.isSafeInteger(n) || n < 1 || n > 10000000)
    fail(400, "Enter whole pennies from 1 to 10000000.");
  return n;
}
export function staff(u: User) {
  if (!["owner", "staff"].includes(u.role)) fail(403, "This is for staff.");
}
export function owner(u: User) {
  if (u.role !== "owner") fail(403, "This is for the owner.");
}
export const digest = (s: string) => createHash("sha256").update(s).digest("hex");
export async function transaction<T>(work: (c: PoolClient) => Promise<T>) {
  const c = await database().connect();
  try {
    await c.query("BEGIN");
    const r = await work(c);
    await c.query("COMMIT");
    return r;
  } catch (e) {
    await c.query("ROLLBACK");
    throw e;
  } finally {
    c.release();
  }
}
export async function campaigns() {
  return (
    await database().query(
      `SELECT c.*,cat.name category,COALESCE((SELECT sum(g.amount) FROM gifts g WHERE g.campaign_id=c.id AND g.status_id='confirmed'),0)::integer raised FROM campaigns c JOIN campaign_categories cat ON cat.id=c.category_id ORDER BY c.title`,
    )
  ).rows;
}
export async function publicDetails(id: unknown) {
  const campaign =
    (await campaigns()).find((c) => c.id === uuid(id)) ?? fail(404, "Campaign not found.");
  const gifts = (
    await database().query(
      "SELECT g.id,CASE WHEN g.anonymous THEN 'Anonymous' ELSE d.name END name,g.amount FROM gifts g JOIN donors d ON d.id=g.donor_id WHERE g.campaign_id=$1 AND g.status_id='confirmed' ORDER BY confirmed_at DESC LIMIT 30",
      [campaign.id],
    )
  ).rows;
  return {
    campaign,
    gifts,
    amounts: (
      await database().query(
        "SELECT id,amount FROM suggested_amounts WHERE campaign_id=$1 ORDER BY amount",
        [campaign.id],
      )
    ).rows,
    updates: (
      await database().query(
        "SELECT id,body,created_at FROM campaign_updates WHERE campaign_id=$1 ORDER BY created_at DESC",
        [campaign.id],
      )
    ).rows,
  };
}
export async function donor(u: User, db: Pick<PoolClient, "query"> = database()) {
  if (u.role !== "donor") fail(403, "Sign in as a donor.");
  return (
    await db.query(
      "INSERT INTO donors(user_id,name,email) VALUES($1,$2,$3) ON CONFLICT(user_id) DO UPDATE SET user_id=EXCLUDED.user_id RETURNING *",
      [u.id, u.email?.split("@")[0], u.email],
    )
  ).rows[0];
}
export async function scoped(
  u: User | null,
  id: unknown,
  token?: string,
  db: Pick<PoolClient, "query"> = database(),
) {
  const r = (
    await db.query(
      "SELECT r.*,d.name,d.email,d.phone,d.user_id FROM giving_requests r JOIN donors d ON d.id=r.donor_id WHERE r.id=$1 AND ($2::boolean OR d.user_id=$3 OR (r.guest_hash=$4 AND r.guest_hash IS NOT NULL))",
      [
        uuid(id),
        !!u && ["owner", "staff"].includes(u.role),
        u?.id ?? null,
        token ? digest(token) : null,
      ],
    )
  ).rows[0];
  return r ?? fail(404, "Giving record not found.");
}
export async function mine(u: User) {
  return {
    requests: (
      await database().query(
        "SELECT r.id,r.amount,r.monthly,r.status,c.title FROM giving_requests r JOIN donors d ON d.id=r.donor_id JOIN campaigns c ON c.id=r.campaign_id WHERE d.user_id=$1 ORDER BY r.created_at DESC",
        [u.id],
      )
    ).rows,
    gifts: (
      await database().query(
        "SELECT g.id,g.request_id,g.amount,c.title,r.year,r.number FROM gifts g JOIN donors d ON d.id=g.donor_id JOIN campaigns c ON c.id=g.campaign_id JOIN receipts r ON r.gift_id=g.id WHERE d.user_id=$1 ORDER BY confirmed_at DESC",
        [u.id],
      )
    ).rows,
  };
}
async function call<T = Record<string, unknown>>(
  id: string,
  input: Record<string, unknown>,
  key?: string,
): Promise<T> {
  if (process.env.PRAMAAN_PAYMENTS_TEST_MODE !== "true")
    fail(503, "Test payments are not switched on. No gift has been counted.");
  const r = await pramaan.call<T>(id, input, key);
  if (!r.ok)
    fail(
      503,
      "Payments are unavailable or awaiting confirmation. Retry the same action. No unconfirmed gift is counted.",
    );
  return r.value;
}
function link(value: unknown) {
  const u = new URL(text(value, 2000));
  if (
    u.username ||
    u.password ||
    !(
      u.protocol === "https:" ||
      (u.protocol === "http:" &&
        u.hostname === "127.0.0.1" &&
        process.env.PRAMAAN_PAYMENTS_TEST_MODE === "true")
    )
  )
    fail(502, "Payment link could not be confirmed.");
  return u.toString();
}
export async function createGiving(u: User | null, b: Record<string, unknown>) {
  const id = uuid(b.requestId);
  const token = u ? null : text(b.guestToken, 150);
  if (token && !/^[a-f0-9]{64}$/.test(token)) fail(400, "Reload the form before giving.");
  await transaction(async (c) => {
    await c.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [id]);
    const old = (await c.query("SELECT id FROM giving_requests WHERE id=$1", [id])).rows[0];
    if (old) {
      await scoped(u, id, token ?? undefined, c);
      return;
    }
    if (b.monthly === true && !u) fail(401, "Sign in to give monthly.");
    if (u && u.role !== "donor") fail(403, "Use a donor account to give.");
    const campaign =
      (
        await c.query(
          "SELECT * FROM campaigns WHERE id=$1 AND open AND starts_at<=CURRENT_DATE AND ends_at>=CURRENT_DATE FOR SHARE",
          [uuid(b.campaignId)],
        )
      ).rows[0] ?? fail(409, "This campaign is closed.");
    const amt = amount(b.amount);
    let d: { id: string };
    if (u) d = await donor(u, c);
    else {
      const email = text(b.email, 254).toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail(400, "Enter an email address.");
      d = (
        await c.query("INSERT INTO donors(name,email) VALUES($1,$2) RETURNING *", [
          text(b.name),
          email,
        ])
      ).rows[0];
    }
    await c.query(
      "INSERT INTO giving_requests(id,donor_id,campaign_id,amount,monthly,anonymous,guest_hash) VALUES($1,$2,$3,$4,$5,$6,$7)",
      [
        id,
        d.id,
        campaign.id,
        amt,
        b.monthly === true,
        b.anonymous === true,
        token ? digest(token) : null,
      ],
    );
  });
  return billing(u, id, "start", token ?? undefined);
}
async function receipt(c: PoolClient, r: Record<string, any>, reference: string) {
  const existing = (
    await c.query("SELECT id,request_id FROM gifts WHERE reference=$1", [reference])
  ).rows[0];
  if (existing) {
    if (existing.request_id !== r.id) fail(502, "Payment could not be matched.");
    return;
  }
  const gift = (
    await c.query(
      "INSERT INTO gifts(request_id,campaign_id,donor_id,amount,anonymous,status_id,reference) VALUES($1,$2,$3,$4,$5,'confirmed',$6) RETURNING id",
      [r.id, r.campaign_id, r.donor_id, r.amount, r.anonymous, reference],
    )
  ).rows[0];
  const year = new Date().getUTCFullYear();
  const counter = (
    await c.query(
      "INSERT INTO receipt_counters(year,last_number) VALUES($1,1) ON CONFLICT(year) DO UPDATE SET last_number=receipt_counters.last_number+1 RETURNING last_number",
      [year],
    )
  ).rows[0];
  await c.query("INSERT INTO receipts(gift_id,year,number) VALUES($1,$2,$3)", [
    gift.id,
    year,
    counter.last_number,
  ]);
}
export async function deliverEmails() {
  return transaction(async (c) => {
    const rows = (
      await c.query(
        "SELECT r.*,g.amount,d.email FROM receipts r JOIN gifts g ON g.id=r.gift_id JOIN donors d ON d.id=g.donor_id WHERE email_status='not-sent' ORDER BY year,number LIMIT 20 FOR UPDATE OF r SKIP LOCKED",
      )
    ).rows;
    for (const r of rows) {
      const sent = await emailDoor.send(
        {
          to: r.email,
          subject: `Thank you — receipt ${r.year}-${r.number}`,
          text: `Thank you for your gift of GBP ${(r.amount / 100).toFixed(2)}. Receipt ${r.year}-${r.number}. This confirms your gift and is not tax advice.`,
        },
        r.id,
      );
      await c.query("UPDATE receipts SET email_status=$2 WHERE id=$1", [r.id, sent.status]);
    }
    return { message: "Receipt emails checked. Unsent emails stay queued while email is off." };
  });
}
export async function billing(u: User | null, id: unknown, action: string, token?: string) {
  await scoped(u, id, token);
  if (u?.role === "staff") fail(403, "Only the donor or owner can change monthly giving.");
  const c = await database().connect();
  try {
    await c.query("SELECT pg_advisory_lock(hashtextextended($1,0))", [String(id)]);
    let r = await scoped(u, id, token, c);
    if (action === "start" && !r.checkout_ref && !r.billing_ref) {
      if (Date.now() - new Date(r.created_at).getTime() > 23 * 3600000)
        fail(409, "This payment attempt needs reconciliation before retrying.");
      if (r.monthly) {
        if (!/^[0-9]{10,12}$/.test(r.phone))
          fail(400, "Save a phone number before giving monthly.");
        const planId = `plan_${r.id.replaceAll("-", "")}`;
        await call(
          "billing.plan.create",
          {
            planId,
            name: "Monthly giving",
            type: "periodic",
            maxAmount: { amount: r.amount, currency: "GBP" },
            recurringAmount: { amount: r.amount, currency: "GBP" },
            interval: "month",
            intervalCount: 1,
          },
          `${r.id}:plan`,
        );
        const s = await call<any>(
          "billing.subscription.create",
          {
            subscriptionId: `sub_${r.id.replaceAll("-", "")}`,
            planId,
            customerName: r.name,
            customerEmail: r.email,
            customerPhone: r.phone,
            authorizationAmount: { amount: r.amount, currency: "GBP" },
            refundAuthorization: false,
            notificationChannels: ["email"],
          },
          `${r.id}:subscription`,
        );
        if (s.subscriptionId !== `sub_${r.id.replaceAll("-", "")}`)
          fail(502, "Monthly giving could not be matched.");
        await c.query(
          "UPDATE giving_requests SET billing_ref=$2,customer_ref=$3,checkout_url=$4 WHERE id=$1",
          [r.id, s.subscriptionId, s.customerId, link(s.authorizationUrl)],
        );
      } else {
        const s = await call<any>(
          "payments.checkout.create",
          {
            lineItems: [{ name: "Community gift", amount: r.amount, currency: "gbp", quantity: 1 }],
            mode: "payment",
            customerEmail: r.email,
            successUrl: `${process.env.APP_ORIGIN}/thanks?id=${r.id}`,
            cancelUrl: `${process.env.APP_ORIGIN}/thanks?id=${r.id}`,
          },
          `${r.id}:checkout`,
        );
        await c.query("UPDATE giving_requests SET checkout_ref=$2,checkout_url=$3 WHERE id=$1", [
          r.id,
          text(s.ref, 200),
          link(s.checkoutUrl),
        ]);
      }
      r = await scoped(u, id, token, c);
    }
    if (action === "start") return { url: r.checkout_url };
    if (!["refresh", "pause", "cancel"].includes(action)) fail(400, "Choose an action.");
    let payments: any[] = [];
    if (r.monthly) {
      if (!r.billing_ref) fail(409, "Start monthly giving first.");
      if (action !== "refresh") {
        if (r.pending_action && r.pending_action !== action)
          fail(409, "Refresh the previous action first.");
        if (!r.pending_action) {
          await c.query(
            "UPDATE giving_requests SET pending_action=$2,action_key=$3,action_at=now() WHERE id=$1",
            [r.id, action, randomUUID()],
          );
          r = await scoped(u, id, token, c);
        }
        if (Date.now() - new Date(r.action_at).getTime() > 23 * 3600000)
          fail(409, "This change needs reconciliation before retrying.");
        await call(
          action === "cancel" ? "billing.subscription.cancel" : "billing.subscription.update",
          action === "cancel"
            ? { subscriptionId: r.billing_ref, when: "period_end" }
            : { subscriptionId: r.billing_ref, action: "pause" },
          r.action_key,
        );
      }
      const s = await call<any>("billing.subscription.get", { subscriptionId: r.billing_ref });
      if (
        s.subscriptionId !== r.billing_ref ||
        s.customerId !== r.customer_ref ||
        s.recurringAmount?.amount !== r.amount ||
        s.recurringAmount?.currency?.toUpperCase() !== "GBP" ||
        s.interval !== "month" ||
        (s.intervalCount ?? 1) !== 1
      )
        fail(502, "Monthly giving terms could not be confirmed.");
      const result = await call<any>("billing.transactions.list", {
        subscriptionId: r.billing_ref,
        customerId: r.customer_ref,
        limit: 100,
      });
      payments = (result.results ?? [])
        .filter(
          (p: any) =>
            p.status === "paid" &&
            p.subscriptionId === r.billing_ref &&
            p.customerId === r.customer_ref &&
            p.total?.amount === r.amount &&
            p.total?.currency?.toUpperCase() === "GBP",
        )
        .map((p: any) => ({ reference: text(p.transactionId, 200) }));
      await c.query("UPDATE giving_requests SET status=$2,pending_action=NULL WHERE id=$1", [
        r.id,
        s.cancelAtPeriodEnd
          ? "cancel_scheduled"
          : ["active", "paused", "canceled", "pending", "past_due"].includes(s.status)
            ? s.status
            : "unknown",
      ]);
    } else {
      if (action !== "refresh") fail(400, "A one-off gift cannot be paused or cancelled.");
      if (!r.checkout_ref) fail(409, "Start the payment first.");
      const s = await call<any>("payments.checkout.get", { ref: r.checkout_ref });
      const ps = s.payments ?? [];
      if (
        s.status === "paid" &&
        ps.length === 1 &&
        ps[0].status === "captured" &&
        ps[0].amount?.amount === r.amount &&
        ps[0].amount?.currency?.toUpperCase() === "GBP"
      )
        payments = [{ reference: text(ps[0].ref, 200) }];
    }
    await c.query("BEGIN");
    try {
      for (const p of payments) await receipt(c, r, p.reference);
      if (payments.length && !r.monthly)
        await c.query("UPDATE giving_requests SET status='confirmed' WHERE id=$1", [r.id]);
      await c.query("COMMIT");
    } catch (e) {
      await c.query("ROLLBACK");
      throw e;
    }
    return {
      message: payments.length
        ? "Gift confirmed. Your numbered receipt is ready."
        : "No new confirmed gift. Progress stays unchanged.",
    };
  } finally {
    await c.query("SELECT pg_advisory_unlock(hashtextextended($1,0))", [String(id)]);
    c.release();
    try {
      await deliverEmails();
    } catch {
      /* Receipts remain durable and queued. */
    }
  }
}
export async function addStaff(u: User, b: Record<string, unknown>) {
  owner(u);
  const email = text(b.email, 254).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail(400, "Enter an email address.");
  const password = text(b.password, 128);
  if (password.length < 12) fail(400, "Use at least 12 characters.");
  const made = await database().query(
    "INSERT INTO app_users(id,email,password_hash,role) VALUES($1,$2,$3,'staff') ON CONFLICT(email) DO NOTHING",
    [randomUUID(), email, await hashPassword(password)],
  );
  if (!made.rowCount) fail(409, "That email already has an account here.");
  return { message: "Staff account added." };
}
export { randomBytes };
