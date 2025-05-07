// main.ts
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
const kv = await Deno.openKv();
const sockets = new Map<string, Set<WebSocket>>();

function logAction(action: string, meta: Record<string, unknown>) {
  const time = Date.now();
  kv.set(["log", time], { action, time, ...meta });
}

async function sendResetEmail(email: string, token: string) {
  const resendKey = Deno.env.get("RESEND_API_KEY");
  const link = `https://sifunastena.deno.dev/reset-password?token=${token}`;
  await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${resendKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      from: "SifunaStena <reset@sifunastena.com>",
      to: email,
      subject: "Reset your SifunaStena password",
      html: `<p>To reset your password, click below:</p><p><a href='${link}'>Reset Password</a></p>`
    })
  });
}

serve(async (req) => {
  const { pathname, searchParams } = new URL(req.url);
  const cookies = req.headers.get("cookie") || "";

  if (pathname === "/" && req.method === "GET") {
    try {
      const file = await Deno.readTextFile("index.html");
      return new Response(file, { headers: { "content-type": "text/html" } });
    } catch (_) {
      return new Response("index.html not found", { status: 500 });
    }
  }

  if (pathname === "/ws" && req.headers.get("upgrade") === "websocket") {
    const { socket, response } = Deno.upgradeWebSocket(req);
    const user = searchParams.get("user");
    if (!user) return new Response("Missing user", { status: 400 });
    if (!sockets.has(user)) sockets.set(user, new Set());
    sockets.get(user)?.add(socket);
    socket.onclose = () => sockets.get(user)?.delete(socket);
    return response;
  }

  if (pathname === "/reset" && req.method === "POST") {
    const { email } = await req.json();
    const token = crypto.randomUUID();
    await kv.set(["reset", token], { email, created: Date.now() });
    await sendResetEmail(email, token);
    logAction("reset-request", { email });
    return new Response("OK");
  }

  if (pathname === "/reset-password" && req.method === "GET") {
    return new Response(`<!DOCTYPE html><html><body>
      <form onsubmit="event.preventDefault(); fetch('/reset-password', {
        method: 'POST', body: JSON.stringify({
        token: new URLSearchParams(location.search).get('token'),
        password: document.getElementById('pw').value })
      }).then(r => r.text()).then(alert)">
        <h2>Reset Password</h2>
        <input id="pw" type="password" placeholder="New password">
        <button type="submit">Reset</button>
      </form>
    </body></html>`, {
      headers: { "content-type": "text/html" }
    });
  }

  if (pathname === "/reset-password" && req.method === "POST") {
    const { token, password } = await req.json();
    const reset = await kv.get(["reset", token]);
    if (!reset.value) return new Response("Invalid token", { status: 400 });
    const { email } = reset.value;
    for await (const entry of kv.list({ prefix: ["user"] })) {
      if (entry.value.email === email) {
        const userKey = entry.key;
        const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(password));
        entry.value.password = Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, "0")).join("");
        await kv.set(userKey, entry.value);
        await kv.delete(["reset", token]);
        logAction("password-reset", { user: userKey[1] });
        return new Response("Password reset successfully");
      }
    }
    return new Response("User not found", { status: 404 });
  }

  if (pathname === "/submit-doc" && req.method === "POST") {
    const data = await req.json();
    const { username, password } = data;
    const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(password));
    data.password = Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, "0")).join("");
    data.verified = false;
    await kv.set(["user", username], data);
    await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${Deno.env.get("RESEND_API_KEY")}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        from: "SifunaStena <admin@sifunastena.com>",
        to: "drewbt@gmail.com",
        subject: `New Signup: ${username}`,
        html: `<p>${data.name} ${data.surname} (${data.email})</p><a href='https://sifunastena.deno.dev/approve?user=${username}'>Approve</a> | <a href='#'>Decline</a>`
      })
    });
    return new Response("Submitted");
  }

  if (pathname === "/approve" && req.method === "GET") {
    const username = searchParams.get("user");
    if (!cookies.includes("username=drewbt@gmail.com")) return new Response("Unauthorized", { status: 401 });
    const user = await kv.get(["user", username]);
    if (!user.value) return new Response("User not found", { status: 404 });
    user.value.verified = true;
    user.value.balance = 50000;
    await kv.set(["user", username], user.value);
    await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${Deno.env.get("RESEND_API_KEY")}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        from: "SifunaStena <admin@sifunastena.com>",
        to: user.value.email,
        subject: `Account Approved`,
        html: `<p>Congratulations! You have received Ϡ50.000 in your SifunaStena account.</p>`
      })
    });
    sockets.get(username)?.forEach(sock => sock.send(JSON.stringify({ type: "balance-update" })));
    return new Response("Approved");
  }

  if (pathname === "/login" && req.method === "POST") {
    const { username, password } = await req.json();
    const user = await kv.get(["user", username]);
    if (!user.value || !user.value.verified) return new Response(JSON.stringify({ ok: false }));
    const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(password));
    const hashed = Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, "0")).join("");
    return new Response(JSON.stringify({ ok: user.value.password === hashed }));
  }

  if (pathname === "/balance" && req.method === "POST") {
    const { username } = await req.json();
    const user = await kv.get(["user", username]);
    return new Response(JSON.stringify({ balance: user.value?.balance || 0 }));
  }

  if (pathname === "/tx" && req.method === "POST") {
    const { username } = await req.json();
    const results = [];
    for await (const entry of kv.list({ prefix: ["tx"] })) {
      const tx = entry.value;
      if (tx.to === username || tx.from === username) results.push(tx);
    }
    results.sort((a, b) => b.datetime - a.datetime);
    return new Response(JSON.stringify({ transactions: results }));
  }

  if (pathname === "/send" && req.method === "POST") {
    const { username, to, amount, message } = await req.json();
    const fromUser = await kv.get(["user", username]);
    const toUser = await kv.get(["user", to]);
    if (!fromUser.value || !toUser.value || fromUser.value.balance < amount) return new Response("Invalid");
    fromUser.value.balance -= amount;
    toUser.value.balance += amount;
    await kv.set(["user", username], fromUser.value);
    await kv.set(["user", to], toUser.value);
    const tx = { from: username, to, amount, message, datetime: Date.now() };
    await kv.set(["tx", crypto.randomUUID()], tx);
    sockets.get(username)?.forEach(sock => sock.send(JSON.stringify({ type: "balance-update" })));
    sockets.get(to)?.forEach(sock => sock.send(JSON.stringify({ type: "balance-update" })));
    return new Response("Sent");
  }

  if (pathname === "/logs" && req.method === "GET") {
    if (!cookies.includes("username=drewbt@gmail.com")) return new Response("Unauthorized", { status: 401 });
    let html = `<!DOCTYPE html><html><head><style>
      body { font-family: system-ui; background: #111; color: #fff; padding: 2rem; }
      table { width: 100%; border-collapse: collapse; margin-top: 1rem; }
      th, td { border: 1px solid #444; padding: 0.5rem; text-align: left; }
      th { background: #222; }
      input { margin: 0.5rem 0; padding: 0.4rem; width: 200px; background: #222; color: #fff; border: 1px solid #444; }
    </style></head><body>
    <h2>System Logs</h2>
    <input placeholder="Filter by action..." oninput="filter(this.value)">
    <table><thead><tr><th>Time</th><th>Action</th><th>User</th><th>Meta</th></tr></thead><tbody id="logbody">`;
    const logs = [];
    for await (const entry of kv.list({ prefix: ["log"] })) logs.push(entry.value);
    logs.sort((a, b) => b.time - a.time);
    for (const log of logs) {
      html += `<tr><td>${new Date(log.time).toLocaleString()}</td><td>${log.action}</td><td>${log.user || log.email || "-"}</td><td><pre>${JSON.stringify(log, null, 2)}</pre></td></tr>`;
    }
    html += `</tbody></table>
    <script>function filter(txt) { document.querySelectorAll('#logbody tr').forEach(row => row.style.display = row.innerText.toLowerCase().includes(txt.toLowerCase()) ? '' : 'none'); }</script></body></html>`;
    return new Response(html, { headers: { "content-type": "text/html" } });
  }

  return new Response("Not Found", { status: 404 });
});
