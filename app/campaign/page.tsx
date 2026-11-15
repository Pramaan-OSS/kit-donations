"use client";
import { useEffect, useState } from "react";
import { api } from "../../lib/pramaan/client";
import type { CampaignDetails } from "../../lib/types";
import { Form, money, post } from "../parts";
export default function Campaign() {
  const [data, setData] = useState<CampaignDetails | null>(null);
  const [error, setError] = useState("");
  const [monthly, setMonthly] = useState(false);
  const [chosen, setChosen] = useState(2500);
  useEffect(() => {
    api<CampaignDetails>(
      `/api/donations?view=campaign&id=${new URLSearchParams(location.search).get("id")}`,
    ).then(setData, (e) => setError(e.message));
  }, []);
  if (!data)
    return (
      <main className="workspace">
        <h1>Campaign</h1>
        <p>{error || "Loading…"}</p>
      </main>
    );
  const c = data.campaign;
  return (
    <main className="workspace">
      <p className="eyebrow">{c.category}</p>
      <h1>{c.title}</h1>
      {c.image_key && (
        <img src={`/api/images?id=${c.id}`} alt="Campaign" style={{ maxWidth: "100%" }} />
      )}
      <p>{c.story}</p>
      <progress max={c.goal} value={c.raised} aria-label="Campaign progress" />
      <p>
        {money(c.raised, "GBP")} raised of {money(c.goal, "GBP")}
      </p>
      <p>
        {c.starts_at.slice(0, 10)} — {c.ends_at.slice(0, 10)} · {c.open ? "Open" : "Closed"}
      </p>
      <section>
        <h2>Make a gift</h2>
        <p>Test mode. No real money is charged. Monthly giving requires a donor account.</p>
        <div>
          {data.amounts.map((a) => (
            <button key={a.id} type="button" onClick={() => setChosen(a.amount)}>
              {money(a.amount, "GBP")}
            </button>
          ))}
        </div>
        <Form
          label="Continue to test payment"
          submit={async (f) => {
            let attempt = JSON.parse(sessionStorage.getItem(`attempt-${c.id}`) || "null");
            if (!attempt) {
              const bytes = crypto.getRandomValues(new Uint8Array(32));
              attempt = {
                requestId: crypto.randomUUID(),
                guestToken: Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join(""),
              };
              sessionStorage.setItem(`attempt-${c.id}`, JSON.stringify(attempt));
            }
            sessionStorage.setItem(`gift-${attempt.requestId}`, attempt.guestToken);
            const result = await post({
              action: "give",
              ...attempt,
              campaignId: c.id,
              amount: chosen,
              monthly,
              anonymous: f.get("anonymous") === "on",
              name: f.get("name"),
              email: f.get("email"),
            });
            sessionStorage.removeItem(`attempt-${c.id}`);
            return result;
          }}
        >
          <label>
            Amount in pennies
            <input
              name="amount"
              type="number"
              min={1}
              max={10000000}
              required
              value={chosen}
              onChange={(e) => setChosen(Number(e.target.value))}
            />
          </label>
          <label>
            Your name
            <input name="name" required maxLength={120} />
          </label>
          <label>
            Email
            <input name="email" type="email" required />
          </label>
          <label>
            <input
              type="checkbox"
              checked={monthly}
              onChange={(e) => setMonthly(e.target.checked)}
            />
            Give monthly
          </label>
          <label>
            <input type="checkbox" name="anonymous" />
            Hide my name publicly
          </label>
        </Form>
      </section>
      <section>
        <h2>Campaign updates</h2>
        {data.updates.map((r) => (
          <p key={r.id}>{r.body}</p>
        ))}
      </section>
      <section>
        <h2>Recent gifts</h2>
        {data.gifts.map((r) => (
          <p key={r.id}>
            {r.name} · {money(r.amount, "GBP")}
          </p>
        ))}
      </section>
    </main>
  );
}
