import { campaigns } from "../lib/donations";
import { money } from "../lib/money";
export const dynamic = "force-dynamic";
export default async function Home() {
  const rows = await campaigns();
  return (
    <main className="workspace">
      <p className="eyebrow">GIVE SOMETHING GOOD</p>
      <h1>
        Small gifts.
        <br />
        Lasting change.
      </h1>
      <p>Support the people and places that make our community stronger.</p>
      <div className="cards">
        {rows.map((c) => (
          <section key={c.id}>
            <p className="eyebrow">{c.category}</p>
            <h2>{c.title}</h2>
            <p>{c.story}</p>
            <progress max={c.goal} value={c.raised} aria-label="Campaign progress" />
            <p>
              {money(c.raised, "GBP")} raised of {money(c.goal, "GBP")}
            </p>
            <a href={`/campaign?id=${c.id}`}>View campaign →</a>
          </section>
        ))}
      </div>
    </main>
  );
}
