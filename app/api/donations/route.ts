import { randomUUID } from "node:crypto";
import { csv, parseCsv } from "../../../lib/csv";
import * as k from "../../../lib/donations";
import { handle, readBody, reply } from "../../../lib/roles/http";
import { accountRuntime, database } from "../../../lib/runtime";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  return handle(async () => {
    const q = new URL(request.url).searchParams;
    const view = q.get("view");
    if (view === "campaigns") return reply({ campaigns: await k.campaigns() });
    if (view === "campaign") return reply(await k.publicDetails(q.get("id")));
    if (view === "guest") {
      const r = await k.scoped(
        null,
        q.get("id"),
        request.headers.get("x-giving-token") ?? undefined,
      );
      return reply({
        request: { id: r.id, status: r.status, amount: r.amount },
        receipts: (
          await database().query(
            "SELECT year,number FROM receipts WHERE gift_id IN (SELECT id FROM gifts WHERE request_id=$1)",
            [r.id],
          )
        ).rows,
      });
    }
    const u = await accountRuntime().requireUser(request);
    if (view === "gift") {
      const gift = (
        await database().query(
          "SELECT g.id,g.amount,g.currency,c.title,r.year,r.number FROM gifts g JOIN donors d ON d.id=g.donor_id JOIN campaigns c ON c.id=g.campaign_id JOIN receipts r ON r.gift_id=g.id WHERE g.id=$1 AND (d.user_id=$2 OR $3::boolean)",
          [k.uuid(q.get("id")), u.id, ["owner", "staff"].includes(u.role)],
        )
      ).rows[0];
      if (!gift) k.fail(404, "Gift not found.");
      return reply({ gift });
    }
    if (view === "record") {
      const r = await k.scoped(u, q.get("id"));
      return reply({ request: { id: r.id, status: r.status, amount: r.amount } });
    }
    if (!view || view === "mine") return reply(await k.mine(u));
    k.staff(u);
    if (view === "manage")
      return reply({
        categories: (await database().query("SELECT * FROM campaign_categories ORDER BY name"))
          .rows,
        donors: (
          await database().query("SELECT id,name,email FROM donors ORDER BY name LIMIT 1000")
        ).rows,
        gifts: (
          await database().query(
            "SELECT g.id,d.name,g.amount,g.anonymous,s.name status FROM gifts g JOIN donors d ON d.id=g.donor_id JOIN gift_statuses s ON s.id=g.status_id ORDER BY confirmed_at DESC LIMIT 1000",
          )
        ).rows,
      });
    if (view === "export") {
      const donors = q.get("kind") === "donors";
      const rows = (
        await database().query(
          donors
            ? "SELECT name,email FROM donors ORDER BY name"
            : "SELECT d.name,d.email,c.title,g.amount,g.currency,s.name status FROM gifts g JOIN donors d ON d.id=g.donor_id JOIN campaigns c ON c.id=g.campaign_id JOIN gift_statuses s ON s.id=g.status_id ORDER BY confirmed_at",
        )
      ).rows;
      return new Response(
        csv([
          donors
            ? ["name", "email"]
            : ["name", "email", "campaign", "amount", "currency", "status"],
          ...rows.map((r) => Object.values(r)),
        ]),
        {
          headers: {
            "content-type": "text/csv",
            "content-disposition": `attachment; filename="${donors ? "donors" : "gifts"}.csv"`,
            "cache-control": "no-store",
          },
        },
      );
    }
    k.owner(u);
    return reply({
      categories: (await database().query("SELECT * FROM campaign_categories ORDER BY name")).rows,
      statuses: (await database().query("SELECT * FROM gift_statuses ORDER BY name")).rows,
    });
  });
}
export async function POST(request: Request) {
  return handle(async () => {
    const b = await readBody(request);
    if (b.action === "give") {
      const u = await accountRuntime()
        .requireUser(request)
        .catch((e) => {
          if (e.status === 401) return null;
          throw e;
        });
      return reply(await k.createGiving(u, b));
    }
    if (b.action === "guest-refresh")
      return reply(
        await k.billing(null, b.id, "refresh", request.headers.get("x-giving-token") ?? undefined),
      );
    const u = await accountRuntime().requireUser(request);
    if (["start", "refresh", "pause", "cancel"].includes(String(b.action)))
      return reply(await k.billing(u, b.id, String(b.action)));
    if (b.action === "profile") {
      const d = await k.donor(u);
      const phone = k.text(b.phone, 12);
      if (!/^[0-9]{10,12}$/.test(phone)) k.fail(400, "Enter 10 to 12 digits.");
      await database().query("UPDATE donors SET name=$2,phone=$3 WHERE id=$1", [
        d.id,
        k.text(b.name),
        phone,
      ]);
      return reply({ message: "Profile saved." });
    }
    k.staff(u);
    switch (b.action) {
      case "campaign": {
        const goal = k.amount(b.goal);
        const start = k.text(b.startsAt, 10),
          end = k.text(b.endsAt, 10);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end) || end < start)
          k.fail(400, "Check campaign dates.");
        if (b.id)
          await database().query(
            "UPDATE campaigns SET title=$2,story=$3,goal=$4,starts_at=$5,ends_at=$6,open=$7,category_id=$8 WHERE id=$1",
            [
              k.uuid(b.id),
              k.text(b.title),
              k.text(b.story, 4000),
              goal,
              start,
              end,
              b.open === true,
              k.uuid(b.categoryId),
            ],
          );
        else
          await database().query(
            "INSERT INTO campaigns(title,story,goal,starts_at,ends_at,open,category_id) VALUES($1,$2,$3,$4,$5,$6,$7)",
            [
              k.text(b.title),
              k.text(b.story, 4000),
              goal,
              start,
              end,
              b.open === true,
              k.uuid(b.categoryId),
            ],
          );
        break;
      }
      case "suggestion":
        await database().query("INSERT INTO suggested_amounts(campaign_id,amount) VALUES($1,$2)", [
          k.uuid(b.campaignId),
          k.amount(b.amount),
        ]);
        break;
      case "remove-suggestion":
        await database().query("DELETE FROM suggested_amounts WHERE id=$1", [k.uuid(b.id)]);
        break;
      case "update":
        await database().query("INSERT INTO campaign_updates(campaign_id,body) VALUES($1,$2)", [
          k.uuid(b.campaignId),
          k.text(b.body, 4000),
        ]);
        break;
      case "donor":
        await database().query("UPDATE donors SET name=$2 WHERE id=$1", [
          k.uuid(b.id),
          k.text(b.name),
        ]);
        break;
      case "import": {
        const rows = parseCsv(k.text(b.csv, 14000));
        if (rows.shift()?.join(",") !== "reference,campaign,name,email,amount")
          k.fail(400, "CSV must start with reference,campaign,name,email,amount.");
        await k.transaction(async (c) => {
          await c.query("SELECT pg_advisory_xact_lock(hashtextextended('offline-import',0))");
          for (const row of rows) {
            if (row.length !== 5) k.fail(400, "Each row needs five fields.");
            const [ref, campaign, name, email, value] = row;
            const reference = `offline:${k.text(ref)}`;
            const old = (await c.query("SELECT id FROM gifts WHERE reference=$1", [reference]))
              .rows[0];
            if (old) continue;
            const camp = (
              await c.query("SELECT id FROM campaigns WHERE title=$1", [k.text(campaign)])
            ).rows;
            if (camp.length !== 1) k.fail(400, "Use a unique campaign title.");
            if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email ?? ""))
              k.fail(400, "Check email addresses.");
            const d = (
              await c.query("INSERT INTO donors(name,email) VALUES($1,$2) RETURNING id", [
                k.text(name),
                email,
              ])
            ).rows[0];
            const gift = (
              await c.query(
                "INSERT INTO gifts(campaign_id,donor_id,amount,status_id,reference) VALUES($1,$2,$3,'confirmed',$4) RETURNING id",
                [camp[0].id, d.id, k.amount(value), reference],
              )
            ).rows[0];
            const year = new Date().getUTCFullYear();
            const n = (
              await c.query(
                "INSERT INTO receipt_counters(year,last_number) VALUES($1,1) ON CONFLICT(year) DO UPDATE SET last_number=receipt_counters.last_number+1 RETURNING last_number",
                [year],
              )
            ).rows[0];
            await c.query("INSERT INTO receipts(gift_id,year,number) VALUES($1,$2,$3)", [
              gift.id,
              year,
              n.last_number,
            ]);
          }
        });
        return reply({ message: "Offline gifts imported. Existing references were skipped." });
      }
      case "emails":
        return reply(await k.deliverEmails());
      default: {
        k.owner(u);
        if (b.action === "staff") return reply(await k.addStaff(u, b));
        if (!["list-add", "list-rename", "list-delete"].includes(String(b.action)))
          k.fail(400, "Choose an action.");
        const table =
          b.kind === "category"
            ? "campaign_categories"
            : b.kind === "status"
              ? "gift_statuses"
              : k.fail(400, "Choose a list.");
        const id = b.action === "list-add" ? randomUUID() : k.text(b.id);
        if (b.action === "list-add")
          await database().query(`INSERT INTO ${table}(id,name) VALUES($1,$2)`, [
            id,
            k.text(b.name),
          ]);
        else if (b.action === "list-rename")
          await database().query(`UPDATE ${table} SET name=$2 WHERE id=$1`, [id, k.text(b.name)]);
        else {
          if (["pending", "confirmed"].includes(id))
            k.fail(409, "This status is required; rename it instead.");
          try {
            await database().query(`DELETE FROM ${table} WHERE id=$1`, [id]);
          } catch {
            k.fail(409, "This value is in use and cannot be removed.");
          }
        }
      }
    }
    return reply({ message: "Saved." });
  });
}
