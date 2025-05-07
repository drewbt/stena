// main.ts
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
const kv = await Deno.openKv();

function logAction(action: string, meta: Record<string, unknown>) {
  const time = Date.now();
  const log = { action, time, ...meta };
  kv.set(["log", time], log);
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

const sockets = new Map<string, Set<WebSocket>>();

serve(async (req) => {
  const cookies = req.headers.get("cookie") || "";
  const url = new URL(req.url);
  const path = url.pathname;

  if (path === "/ws" && req.headers.get("upgrade") === "websocket") {
    const { socket, response } = Deno.upgradeWebSocket(req);
    const user = url.searchParams.get("user");
    if (!user) return new Response("Missing user", { status: 400 });
    if (!sockets.has(user)) sockets.set(user, new Set());
    sockets.get(user)?.add(socket);
    socket.onclose = () => sockets.get(user)?.delete(socket);
    return response;
  }

  // RESET EMAIL REQUEST
  if (path === "/reset" && req.method === "POST") {
    const { email } = await req.json();
    const token = crypto.randomUUID();
    await kv.set(["reset", token], { email, created: Date.now() });
    await sendResetEmail(email, token);
    logAction("reset-request", { email, ip: req.headers.get("x-forwarded-for") });
    return new Response("OK");
  }

  // HANDLE RESET FORM SUBMIT (POST)
  if (path === "/reset-password" && req.method === "POST") {
    const { token, password } = await req.json();
    const reset = await kv.get(["reset", token]);
    if (!reset.value) return new Response("Invalid token", { status: 400 });
    const { email } = reset.value;
    for await (const entry of kv.list({ prefix: ["user"] })) {
      if (entry.value.email === email) {
        const userKey = entry.key;
        const data = entry.value;
        const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(password));
        data.password = Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, "0")).join("");
        await kv.set(userKey, data);
        if (sockets.has(userKey[1])) sockets.get(userKey[1])?.forEach(s => s.send(JSON.stringify({ type: 'balance-update' })));

        await kv.delete(["reset", token]);
        logAction("password-reset", { user: userKey[1], ip: req.headers.get("x-forwarded-for") });
        return new Response("Password reset successfully");
      }
    }
    return new Response("User not found", { status: 404 });
  }

  // HANDLE RESET PAGE (GET)
  if (path === "/reset-password" && req.method === "GET") {
    const html = `<!DOCTYPE html><html><body>
      <form method="POST" onsubmit="event.preventDefault(); fetch('/reset-password', { method: 'POST', body: JSON.stringify({ token: new URLSearchParams(location.search).get('token'), password: document.getElementById('pw').value }) }).then(r => r.text()).then(alert);">
        <h2>Reset Password</h2>
        <input id="pw" type="password" placeholder="New password" required />
        <button type="submit">Reset</button>
      </form>
    </body></html>`;
    return new Response(html, { headers: { "content-type": "text/html" } });
  }

  // LOG VIEWER FOR drewbt@gmail.com
  if (path === "/logs" && req.method === "GET") {
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
    <table><thead><tr><th>Time</th><th>Action</th><th>User</th><th>IP</th><th>Meta</th></tr></thead><tbody id="logbody">`;

    const logs = [];
    for await (const entry of kv.list({ prefix: ["log"] })) logs.push(entry.value);
    logs.sort((a, b) => b.time - a.time);
    for (const log of logs) {
      html += `<tr><td>${new Date(log.time).toLocaleString()}</td><td>${log.action}</td><td>${log.user || log.email || "-"}</td><td>${log.ip || "-"}</td><td><pre>${JSON.stringify(log, null, 2)}</pre></td></tr>`;
    }

    html += `</tbody></table>
    <script>
      function filter(txt) {
        document.querySelectorAll("#logbody tr").forEach(row => {
          row.style.display = row.innerText.toLowerCase().includes(txt.toLowerCase()) ? '' : 'none';
        });
      }
    </script>
    </body></html>`;
    return new Response(html, { headers: { "content-type": "text/html" } });
  }
});
