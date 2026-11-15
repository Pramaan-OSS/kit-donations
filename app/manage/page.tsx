"use client";
import { useCallback, useEffect, useState } from "react";
import { api } from "../../lib/pramaan/client";
import type { Campaign, Desk } from "../../lib/types";
import { Form, money, post } from "../parts";
export default function Manage() {
  const [data, setData] = useState<Desk | null>(null);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [error, setError] = useState("");
  const load = useCallback(
    () => api<Desk>("/api/donations?view=manage").then(setData, (e) => setError(e.message)),
    [],
  );
  useEffect(() => {
    void load();
    api<{ campaigns: Campaign[] }>("/api/donations?view=campaigns").then((d) =>
      setCampaigns(d.campaigns),
    );
  }, [load]);
  return (
    <main className="workspace">
      <h1>Campaign desk</h1>
      <p>{error}</p>
      {data && (
        <>
          <p>
            <a href="/api/donations?view=export&kind=donors">Export donors</a> ·{" "}
            <a href="/api/donations?view=export">Export gifts</a>
          </p>
          <section>
            <h2>New campaign</h2>
            <Form
              label="Create campaign"
              submit={(f) =>
                post({
                  action: "campaign",
                  title: f.get("title"),
                  story: f.get("story"),
                  goal: f.get("goal"),
                  categoryId: f.get("category"),
                  startsAt: f.get("start"),
                  endsAt: f.get("end"),
                  open: true,
                })
              }
            >
              <label>
                Title
                <input name="title" required />
              </label>
              <label>
                Story
                <textarea name="story" required />
              </label>
              <label>
                Goal in pennies
                <input name="goal" type="number" min={1} required />
              </label>
              <label>
                Category
                <select name="category">
                  {data.categories.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Starts
                <input name="start" type="date" required />
              </label>
              <label>
                Ends
                <input name="end" type="date" required />
              </label>
            </Form>
          </section>
          {campaigns.map((c) => (
            <section key={c.id}>
              <h2>{c.title}</h2>
              <Form
                submit={async (f) =>
                  post({
                    action: "campaign",
                    id: c.id,
                    title: f.get("title"),
                    story: f.get("story"),
                    goal: f.get("goal"),
                    startsAt: f.get("start"),
                    endsAt: f.get("end"),
                    open: f.get("open") === "on",
                    categoryId: f.get("category"),
                  })
                }
              >
                <label>
                  Category
                  <select name="category" defaultValue={c.category_id}>
                    {data.categories.map((r: { id: string; name: string }) => (
                      <option key={r.id} value={r.id}>
                        {r.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Campaign title
                  <input name="title" defaultValue={c.title} required />
                </label>
                <label>
                  Story
                  <textarea name="story" defaultValue={c.story} required />
                </label>
                <label>
                  Goal in pennies
                  <input type="number" name="goal" defaultValue={c.goal} required />
                </label>
                <label>
                  Start date
                  <input
                    type="date"
                    name="start"
                    defaultValue={c.starts_at.slice(0, 10)}
                    required
                  />
                </label>
                <label>
                  End date
                  <input type="date" name="end" defaultValue={c.ends_at.slice(0, 10)} required />
                </label>
                <label>
                  <input type="checkbox" name="open" defaultChecked={c.open} />
                  Open for gifts
                </label>
              </Form>
              <Form
                label="Post update"
                submit={(f) => post({ action: "update", campaignId: c.id, body: f.get("body") })}
              >
                <label>
                  Campaign update
                  <textarea name="body" required maxLength={4000} />
                </label>
              </Form>
              <Form
                label="Add suggested amount"
                submit={(f) =>
                  post({ action: "suggestion", campaignId: c.id, amount: f.get("amount") })
                }
              >
                <label>
                  Suggested pennies
                  <input name="amount" type="number" required min={1} />
                </label>
              </Form>
              <Form
                label="Upload image"
                submit={async (f) => {
                  const file = f.get("image") as File;
                  return api(`/api/images?id=${c.id}`, {
                    method: "PUT",
                    headers: { "content-type": "image/png" },
                    body: file,
                  });
                }}
              >
                <label>
                  Campaign image (PNG, up to 2 MB)
                  <input type="file" name="image" accept="image/png" required />
                </label>
              </Form>
            </section>
          ))}
          <section>
            <h2>Donors</h2>
            {data.donors.map((d) => (
              <Form
                key={d.id}
                label="Save donor name"
                submit={async (f) => {
                  const r = await post({ action: "donor", id: d.id, name: f.get("name") });
                  void load();
                  return r;
                }}
              >
                <label>
                  {d.email}
                  <input name="name" defaultValue={d.name} required />
                </label>
              </Form>
            ))}
          </section>
          <section>
            <h2>Gifts</h2>
            {data.gifts.map((g) => (
              <p key={g.id}>
                {g.name} · {money(g.amount, "GBP")} · {g.status}
                {g.anonymous ? " · Anonymous publicly" : ""}
              </p>
            ))}
          </section>
          <section>
            <h2>Offline gifts</h2>
            <Form
              label="Import offline gifts"
              submit={async (f) => {
                const r = await post({ action: "import", csv: f.get("csv") });
                void load();
                return r;
              }}
            >
              <label>
                CSV: reference,campaign,name,email,amount
                <textarea name="csv" required />
              </label>
            </Form>
          </section>
          <Form label="Send queued receipt emails" submit={() => post({ action: "emails" })}>
            {null}
          </Form>
        </>
      )}
    </main>
  );
}
