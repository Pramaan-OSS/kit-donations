"use client";
import { useCallback, useEffect, useState } from "react";
import { api } from "../../lib/pramaan/client";
import type { Settings } from "../../lib/types";
import { Action, Form, post } from "../parts";
export default function SettingsPage() {
  const [data, setData] = useState<Settings | null>(null);
  const [error, setError] = useState("");
  const load = useCallback(
    () => api<Settings>("/api/donations?view=settings").then(setData, (e) => setError(e.message)),
    [],
  );
  useEffect(() => {
    void load();
  }, [load]);
  return (
    <main className="workspace">
      <h1>Owner settings</h1>
      <p>{error}</p>
      {data && (
        <>
          <section>
            <h2>Add staff</h2>
            <Form
              label="Add staff"
              submit={(f) =>
                post({ action: "staff", email: f.get("email"), password: f.get("password") })
              }
            >
              <label>
                Staff email
                <input name="email" type="email" required />
              </label>
              <label>
                Temporary password
                <input name="password" type="password" minLength={12} required />
              </label>
            </Form>
          </section>
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
          {["category", "status"].map((kind) => (
            <section key={kind}>
              <h2>{kind === "category" ? "Campaign categories" : "Gift statuses"}</h2>
              {(kind === "category" ? data.categories : data.statuses).map((r) => (
                <div key={r.id}>
                  <Form
                    label="Rename"
                    submit={async (f) => {
                      const result = await post({
                        action: "list-rename",
                        kind,
                        id: r.id,
                        name: f.get("name"),
                      });
                      void load();
                      return result;
                    }}
                  >
                    <label>
                      {r.name}
                      <input name="name" defaultValue={r.name} required />
                    </label>
                  </Form>
                  <Action
                    input={{ action: "list-delete", kind, id: r.id }}
                    reload={() => void load()}
                  >
                    Remove
                  </Action>
                </div>
              ))}
              <Form
                label="Add value"
                submit={async (f) => {
                  const r = await post({ action: "list-add", kind, name: f.get("name") });
                  void load();
                  return r;
                }}
              >
                <label>
                  New {kind}
                  <input name="name" required />
                </label>
              </Form>
            </section>
          ))}
        </>
      )}
    </main>
  );
}
