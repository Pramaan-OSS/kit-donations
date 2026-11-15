import { randomUUID } from "node:crypto";
import { fail, staff, uuid } from "../../../lib/donations";
import { handle } from "../../../lib/roles/http";
import { accountRuntime, database } from "../../../lib/runtime";
import { storage } from "../../../lib/storage";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  return handle(async () => {
    const id = uuid(new URL(request.url).searchParams.get("id"));
    const c = (await database().query("SELECT image_key FROM campaigns WHERE id=$1", [id])).rows[0];
    if (!c?.image_key) fail(404, "Image not found.");
    const result = await storage("GET", c.image_key);
    if (!result.ok) fail(503, result.message);
    return new Response(new Uint8Array(result.body), {
      headers: {
        "content-type": "image/png",
        "x-content-type-options": "nosniff",
        "cache-control": "no-store",
      },
    });
  });
}
export async function PUT(request: Request) {
  return handle(async () => {
    const u = await accountRuntime().requireUser(request);
    staff(u);
    if (request.headers.get("origin") !== (process.env.APP_ORIGIN ?? new URL(request.url).origin))
      fail(403, "Refresh and try again.");
    const id = uuid(new URL(request.url).searchParams.get("id"));
    if (!(await database().query("SELECT id FROM campaigns WHERE id=$1", [id])).rowCount)
      fail(404, "Campaign not found.");
    const reader = request.body?.getReader();
    if (!reader) fail(400, "Choose a PNG image.");
    const chunks: Uint8Array[] = [];
    let size = 0;
    for (;;) {
      const r = await reader.read();
      if (r.done) break;
      size += r.value.byteLength;
      if (size > 2000000) {
        await reader.cancel();
        fail(413, "Choose an image under 2 MB.");
      }
      chunks.push(r.value);
    }
    const bytes = Buffer.concat(chunks);
    if (bytes.length < 8 || bytes.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a")
      fail(400, "Choose a PNG image.");
    const key = `campaign-${id}-${randomUUID()}.png`;
    const r = await storage("PUT", key, bytes);
    if (!r.ok) fail(503, r.message);
    await database().query("UPDATE campaigns SET image_key=$2 WHERE id=$1", [id, key]);
    return Response.json({ message: "Image saved." });
  });
}
