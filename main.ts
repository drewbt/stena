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

async function sendUserActivationEmail(email: string) {
  const resendKey = Deno.env.get("RESEND_API_KEY");
  await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${resendKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      from: "Sifunastena <onboarding@sifunastena.com>",
      to: email,
      subject: "Account Activated!",
      html: `<p>Congratulations! 🎉</p><p>You have received a sum of Fifty Stena (Ϡ50.000) in your <strong>SifunaStena</strong> account.</p>`
    })
  });
}

serve(async (req) => {
  const url = new URL(req.url);
  const path = url.pathname;

  if (path === "/" && req.method === "GET") {
    try {
      const html = await Deno.readTextFile("./index.html");
      return new Response(html, { headers: { "content-type": "text/html" } });
    } catch (err) {
      return new Response("Error loading index.html", { status: 500 });
    }
  }

  // USER APPROVAL LOGIC
  if (path === "/approve" && req.method === "GET") {
    const cookies = req.headers.get("cookie") || "";
    const isAdmin = cookies.includes("username=drewbt@gmail.com");
    if (!isAdmin) return new Response("Unauthorized", { status: 401 });

    const username = url.searchParams.get("user");
    if (!username) return new Response("Missing user", { status: 400 });
    const userKey = ["user", username];
    const user = await kv.get(userKey);
    if (!user.value) return new Response("User not found", { status: 404 });
    await kv.set(userKey, { ...user.value, status: "active", balance: 50000, lastDrop: currentMonthKey() });
    await sendUserActivationEmail(user.value.email);
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
    const { username, name, surname, email, cell, password, fileName, fileData } = await req.json();
    const hash = await hashPassword(password);
    const userKey = ["user", username];
    await kv.set(userKey, { password: hash, name, surname, email, cell, status: "pending" });
    await sendSignupEmail({ to: "drewbt@gmail.com", name: name + ' ' + surname, username, email, cell, fileName, base64: fileData });
    return new Response("OK");
  }

  // LOGIN
  if (path === "/login" && req.method === "POST") {
    const { username, password } = await req.json();
    const userKey = ["user", username];
    const user = await kv.get(userKey);
    if (!user.value || user.value.status !== "active") return Response.json({ ok: false });
    const hash = await hashPassword(password);
    const ok = user.value.password === hash;
    return new Response(JSON.stringify({ ok }), {
      headers: { "set-cookie": `username=${username}; Path=/; HttpOnly` }
    });
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

  // SEND STENA
  if (path === "/send" && req.method === "POST") {
    const { username, to, amount, message } = await req.json();
    if (!username || !to || !amount || isNaN(amount)) return new Response("Invalid send request", { status: 400 });
    const senderKey = ["user", username];
    const receiverKey = ["user", to];
    const [sender, receiver] = await Promise.all([kv.get(senderKey), kv.get(receiverKey)]);
    if (!sender.value || !receiver.value || sender.value.balance < amount) {
      return new Response("Transfer error", { status: 400 });
    }
    const txTime = Date.now();
    const entry = { from: username, to, amount, datetime: txTime, message: message || "" };
    await kv.atomic()
      .check(sender)
      .check(receiver)
      .set(senderKey, { ...sender.value, balance: sender.value.balance - amount })
      .set(receiverKey, { ...receiver.value, balance: receiver.value.balance + amount })
      .set(["tx", username, txTime], entry)
      .set(["tx", to, txTime], entry)
      .commit();
    return Response.json({ ok: true });
  }

  // GET TX HISTORY
  if (path === "/tx" && req.method === "POST") {
    const { username } = await req.json();
    const prefix = ["tx", username];
    const txs = [];
    for await (const entry of kv.list({ prefix })) {
      txs.push(entry.value);
    }
    txs.sort((a, b) => b.datetime - a.datetime);
    return Response.json({ transactions: txs });
  }

  // WELCOME PAGE
  if (path === "/welcome" && req.method === "GET") {
    return new Response(`<!DOCTYPE html><html><head><title>Welcome</title></head><body><h1>Welcome to SifunaStena</h1><p>You will receive an email once you have been verified.</p></body></html>`, {
      headers: { "content-type": "text/html" }
    });
  }

  return new Response("Not found", { status: 404 });
});
