// main.ts

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

const kv = await Deno.openKv();
const sockets = new Map<string, Set<WebSocket>>();
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");

serve(async (req) => {
  const url = new URL(req.url);

  if (url.pathname === "/ws") {
    const user = url.searchParams.get("user");
    if (!user) return new Response("Missing user", { status: 400 });

    const { socket, response } = Deno.upgradeWebSocket(req);

    socket.onopen = () => {
      if (!sockets.has(user)) sockets.set(user, new Set());
      sockets.get(user)?.add(socket);
    };

    socket.onclose = () => {
      sockets.get(user)?.delete(socket);
    };

    return response;
  }

  if (url.pathname === "/signup" && req.method === "POST") {
    const { name, surname, email, cell, password, idb64 } = await req.json();
    const key = ["user", email];
    const user = { name, surname, cell, password, idb64, approved: false, balance: 0 };
    await kv.set(key, user);

    // Email admin for approval
    await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: "noreply@sifunastena.co.za",
        to: "drewbt@gmail.com",
        subject: "New Signup",
        html: `Approve user <b>${email}</b>?
               <a href='/approve?email=${email}'>Approve</a>
               <a href='/decline?email=${email}'>Decline</a>`
      })
    });

    return new Response("Signup received", { status: 200 });
  }

  if (url.pathname === "/approve") {
    const email = url.searchParams.get("email") ?? "";
    const key = ["user", email];
    const user = (await kv.get(key)).value;
    if (!user) return new Response("User not found", { status: 404 });
    user.approved = true;
    user.balance = 50000;
    await kv.set(key, user);
    sockets.get(email)?.forEach(ws => ws.send("approved"));
    return new Response("Approved");
  }

  if (url.pathname === "/login" && req.method === "POST") {
    const { email, password } = await req.json();
    const user = (await kv.get(["user", email])).value;
    if (!user || user.password !== password) {
      await new Promise(r => setTimeout(r, 5000));
      return new Response("Invalid", { status: 403 });
    }
    return new Response(JSON.stringify({
      name: user.name,
      balance: user.balance,
      approved: user.approved
    }));
  }

  if (url.pathname === "/send" && req.method === "POST") {
    const { from, to, amount, message } = await req.json();
    const fromKey = ["user", from];
    const toKey = ["user", to];
    const fromUser = (await kv.get(fromKey)).value;
    const toUser = (await kv.get(toKey)).value;

    if (!fromUser || !toUser || fromUser.balance < amount) return new Response("Invalid", { status: 400 });

    fromUser.balance -= amount;
    toUser.balance += amount;

    await kv.set(fromKey, fromUser);
    await kv.set(toKey, toUser);

    const tx = { from, to, amount, message, time: new Date().toISOString() };
    await kv.set(["tx", Date.now()], tx);
    sockets.get(from)?.forEach(ws => ws.send("update"));
    sockets.get(to)?.forEach(ws => ws.send("update"));

    return new Response("OK");
  }

  if (url.pathname === "/tx" && req.method === "POST") {
    const { email } = await req.json();
    const iter = kv.list({ prefix: ["tx"] });
    const txs: unknown[] = [];
    for await (const entry of iter) {
      if (entry.value.from === email || entry.value.to === email) {
        txs.push(entry.value);
      }
    }
    return new Response(JSON.stringify(txs));
  }

  if (url.pathname === "/logs") {
    const cookies = Object.fromEntries(req.headers.get("cookie")?.split(";").map(c => c.trim().split("=")) ?? []);
    if (cookies.username !== "drewbt@gmail.com") return new Response("Forbidden", { status: 403 });
    const iter = kv.list({ prefix: ["log"] });
    const logs: unknown[] = [];
    for await (const entry of iter) logs.push(entry.value);
    return new Response(JSON.stringify(logs));
  }

  if (url.pathname === "/") {
    const html = await Deno.readTextFile("index.html");
    return new Response(html, {
      headers: { "content-type": "text/html" },
    });
  }

  return new Response("Not Found", { status: 404 });
});
