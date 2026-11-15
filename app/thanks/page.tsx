"use client";
import { useState } from "react";
import { api } from "../../lib/pramaan/client";
import { Form, money } from "../parts";
export default function Thanks() {
  const [amount, setAmount] = useState(0);
  const [receipts, setReceipts] = useState<any[]>([]);
  return (
    <main className="workspace">
      <h1>Thank you for giving.</h1>
      <p>
        Your gift counts after payment is confirmed. Keep this browser open to read your guest
        receipt.
      </p>
      <Form
        label="Check payment and receipt"
        submit={async () => {
          const id = new URLSearchParams(location.search).get("id");
          const token = sessionStorage.getItem(`gift-${id}`) || "";
          const signed = await api("/api/account/session").then(
            () => true,
            () => false,
          );
          const r = await api<any>("/api/donations", {
            method: "POST",
            headers: { "content-type": "application/json", "x-giving-token": token },
            body: JSON.stringify({ action: signed ? "refresh" : "guest-refresh", id }),
          });
          const d = await api<any>(
            signed ? "/api/donations" : `/api/donations?view=guest&id=${id}`,
            {
              headers: { "x-giving-token": token },
            },
          );
          d.receipts = signed
            ? d.gifts.filter((g: { request_id: string }) => g.request_id === id)
            : d.receipts;
          setReceipts(d.receipts);
          setAmount(
            signed
              ? (d.gifts.find((g: { request_id: string }) => g.request_id === id)?.amount ?? 0)
              : d.request.amount,
          );
          if (d.receipts.length)
            for (let n = 0; n < sessionStorage.length; n++) {
              const key = sessionStorage.key(n);
              if (key?.startsWith("attempt-") && sessionStorage.getItem(key)?.includes(String(id)))
                sessionStorage.removeItem(key);
            }
          return r;
        }}
      >
        {null}
      </Form>
      {receipts.map((r) => (
        <p key={r.number}>
          Receipt {r.year}-{r.number} · {money(amount, "GBP")}
        </p>
      ))}
      <a href="/giving">My signed-in giving</a>
    </main>
  );
}
