"use client";
import { useCallback, useEffect, useState } from "react";
import { api } from "../../lib/pramaan/client";
import type { Giving } from "../../lib/types";
import { Action, Form, money, post } from "../parts";
export default function GivingPage() {
  const [data, setData] = useState<Giving | null>(null);
  const [error, setError] = useState("");
  const load = useCallback(
    () => api<Giving>("/api/donations").then(setData, (e) => setError(e.message)),
    [],
  );
  useEffect(() => {
    void load();
  }, [load]);
  return (
    <main className="workspace">
      <h1>My giving</h1>
      <p>{error}</p>
      <section>
        <h2>Donor profile</h2>
        <Form
          submit={async (f) =>
            post({ action: "profile", name: f.get("name"), phone: f.get("phone") })
          }
        >
          <label>
            Your name
            <input required name="name" />
          </label>
          <label>
            Phone number
            <input required name="phone" pattern="[0-9]{10,12}" />
          </label>
        </Form>
      </section>
      <h2>Giving and monthly gifts</h2>
      {data?.requests.map((r) => (
        <section key={r.id}>
          <h3>{r.title}</h3>
          <p>
            {money(r.amount, "GBP")} · {r.monthly ? "Monthly" : "One-off"} ·{" "}
            {String(r.status).replaceAll("_", " ")}
          </p>
          <Action input={{ action: "start", id: r.id }}>Return to payment</Action>
          <Action input={{ action: "refresh", id: r.id }} reload={() => void load()}>
            Check payment
          </Action>
          {r.monthly && (
            <>
              <Action input={{ action: "pause", id: r.id }} reload={() => void load()}>
                Pause monthly giving
              </Action>
              <Action input={{ action: "cancel", id: r.id }} reload={() => void load()}>
                Cancel at period end
              </Action>
            </>
          )}
        </section>
      ))}
      <h2>Gifts and receipts</h2>
      {data?.gifts.map((r) => (
        <section key={r.id}>
          <h3>{r.title}</h3>
          <p>
            {money(r.amount, "GBP")} · Receipt {r.year}-{r.number}
          </p>
        </section>
      ))}
    </main>
  );
}
