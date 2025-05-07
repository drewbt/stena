// main.ts
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { sendSignupEmail } from "./resend.ts";
const kv = await Deno.openKv();

async function hashPassword(password: string): Promise<string> {
  const data = new TextEncoder().encode(password);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, "0")).join("");
}

function currentMonthKey(): string {
  const now = new Date();
  return `${now.getFullYear()}-${(now.getMonth() + 1).toString().padStart(2, '0')}`;
}

serve(async (req) => {
  const url = new URL(req.url);
  const path = url.pathname;

  // USER APPROVAL LOGIC
  if (path === "/approve" && req.method === "GET") {
    const username = url.searchParams.get("user");
    if (!username) return new Response("Missing user", { status: 400 });
    const userKey = ["user", username];
    const user = await kv.get(userKey);
    if (!user.value) return new Response("User not found", { status: 404 });
    await kv.set(userKey, { ...user.value, status: "active", balance: 50000, lastDrop: currentMonthKey() });
    return new Response("User approved and funded.");
  }

  if (path === "/decline" && req.method === "GET") {
    const username = url.searchParams.get("user");
    const userKey = ["user", username];
    await kv.delete(userKey);
    return new Response("User declined and deleted.");
  }

  // DOC SUBMIT
  if (path === "/submit-doc" && req.method === "POST") {
    const { username, name, email, cell, password, fileName, fileData } = await req.json();
    const hash = await hashPassword(password);
    const userKey = ["user", username];
    await kv.set(userKey, { password: hash, name, email, cell, status: "pending" });
    await sendSignupEmail({ to: "drewbt@gmail.com", name, username, email, cell, fileName, base64: fileData });
    return Response.json({ ok: true });
  }

  // LOGIN
  if (path === "/login" && req.method === "POST") {
    const { username, password } = await req.json();
    const userKey = ["user", username];
    const user = await kv.get(userKey);
    if (!user.value || user.value.status !== "active") return Response.json({ ok: false });
    const hash = await hashPassword(password);
    return Response.json({ ok: user.value.password === hash });
  }

  // BALANCE W/ MONTHLY DROP
  if (path === "/balance" && req.method === "POST") {
    const { username } = await req.json();
    const key = ["user", username];
    const user = await kv.get(key);
    if (!user.value) return Response.json({ balance: 0 });
    const month = currentMonthKey();
    if (user.value.status === "active" && user.value.lastDrop !== month) {
      user.value.balance += 50000;
      user.value.lastDrop = month;
      await kv.set(key, user.value);
    }
    return Response.json({ balance: user.value.balance });
  }

  return new Response("Not found", { status: 404 });
});
