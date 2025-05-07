import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
const kv = await Deno.openKv();

// SHA-256 password hashing
async function hashPassword(password: string): Promise<string> {
  const data = new TextEncoder().encode(password);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash))
    .map(b => b.toString(16).padStart(2, "0"))
    .join("");
}

// Embedded minimal HTML UI (single-page app)
const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Minimal Bank</title>
  <style>
    body { margin:0; background:#121212; color:#fff; font-family:sans-serif; display:flex; flex-direction:column; align-items:center; justify-content:center; height:100vh; }
    .screen { display:none; flex-direction:column; width:90%; max-width:400px; }
    .active { display:flex; }
    input, button { margin:10px 0; padding:10px; font-size:16px; border:none; border-radius:5px; }
    input { background:#222; color:#fff; }
    button { background:#00c896; color:#000; cursor:pointer; }
    .transactions div { background:#1e1e1e; margin:4px 0; padding:8px; border-radius:4px; }
  </style>
</head>
<body>
  <div class="screen active" id="login">
    <h2>Login</h2>
    <input id="username" placeholder="Username" />
    <input id="password" type="password" placeholder="Password" />
    <button onclick="login()">Log In</button>
    <button onclick="register()">Register</button>
  </div>
  <div class="screen" id="dashboard">
    <h2>Balance: $<span id="balance">0</span></h2>
    <button onclick="showSend()">Send Money</button>
    <div class="transactions" id="txlist"></div>
    <button onclick="goTo('login')">Log Out</button>
  </div>
  <div class="screen" id="send">
    <h2>Send Money</h2>
    <input id="to" placeholder="To (username)" />
    <input id="amount" type="number" placeholder="Amount" />
    <button onclick="sendMoney()">Send</button>
    <button onclick="goTo('dashboard')">Back</button>
  </div>
  <script>
    let username = "";

    function goTo(id) {
      document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
      document.getElementById(id).classList.add('active');
    }

    async function register() {
      username = document.getElementById('username').value;
      const password = document.getElementById('password').value;
      await fetch('/register', {
        method: 'POST',
        body: JSON.stringify({ username, password })
      });
      login();
    }

    async function login() {
      username = document.getElementById('username').value;
      const password = document.getElementById('password').value;
      const res = await fetch('/login', {
        method: 'POST',
        body: JSON.stringify({ username, password })
      });
      const data = await res.json();
      if (data.ok) {
        await loadDashboard();
        goTo('dashboard');
      } else {
        alert('Login failed');
      }
    }

    async function loadDashboard() {
      const bal = await fetch('/balance', {
        method: 'POST',
        body: JSON.stringify({ username })
      }).then(r => r.json());
      document.getElementById('balance').textContent = bal.balance;

      const tx = await fetch('/transactions', {
        method: 'POST',
        body: JSON.stringify({ username })
      }).then(r => r.json());
      document.getElementById('txlist').innerHTML = tx.transactions.map(t => '<div>' + t + '</div>').join('');
    }

    function showSend() {
      goTo('send');
    }

    async function sendMoney() {
      const to = document.getElementById('to').value;
      const amount = +document.getElementById('amount').value;
      await fetch('/send', {
        method: 'POST',
        body: JSON.stringify({ from: username, to, amount })
      });
      await loadDashboard();
      goTo('dashboard');
    }
  </script>
</body>
</html>
`;

// KV-backed request handlers
serve(async (req) => {
  const url = new URL(req.url);
  const path = url.pathname;

  if (req.method === "GET" && path === "/") {
    return new Response(html, {
      headers: { "content-type": "text/html" }
    });
  }

  try {
    const { username, password, from, to, amount } = await req.json();

    if (req.method === "POST" && path === "/register") {
      const key = ["user", username];
      const existing = await kv.get(key);
      if (existing.value) return Response.json({ ok: false, error: "User exists" });
      await kv.set(key, {
        password: await hashPassword(password),
        balance: 1000
      });
      return Response.json({ ok: true });
    }

    if (req.method === "POST" && path === "/login") {
      const key = ["user", username];
      const user = await kv.get(key);
      if (!user.value) return Response.json({ ok: false });
      const hashed = await hashPassword(password);
      return Response.json({ ok: hashed === user.value.password });
    }

    if (req.method === "POST" && path === "/balance") {
      const user = await kv.get(["user", username]);
      return Response.json({ ok: true, balance: user.value?.balance ?? 0 });
    }

    if (req.method === "POST" && path === "/transactions") {
      const prefix = ["tx", username];
      const txs: string[] = [];
      for await (const entry of kv.list({ prefix })) {
        txs.push(entry.value);
      }
      txs.sort(); // sort chronologically
      return Response.json({ ok: true, transactions: txs });
    }

    if (req.method === "POST" && path === "/send") {
      const [senderKey, receiverKey] = [["user", from], ["user", to]];
      const [sender, receiver] = await Promise.all([
        kv.get(senderKey),
        kv.get(receiverKey),
      ]);
      if (!sender.value || !receiver.value || sender.value.balance < amount)
        return Response.json({ ok: false, error: "Invalid transfer" });

      await kv.atomic()
        .check(sender)
        .check(receiver)
        .set(senderKey, {
          ...sender.value,
          balance: sender.value.balance - amount
        })
        .set(receiverKey, {
          ...receiver.value,
          balance: receiver.value.balance + amount
        })
        .set(["tx", from, Date.now()], `- $${amount} to ${to}`)
        .set(["tx", to, Date.now()], `+ $${amount} from ${from}`)
        .commit();

      return Response.json({ ok: true });
    }

  } catch (err) {
    console.error("ERR:", err);
    return new Response("Bad Request", { status: 400 });
  }

  return new Response("Not Found", { status: 404 });
});

