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
    const { username, name, surname, email, cell, password, fileName, fileData } = await req.json();
    const hash = await hashPassword(password);
    const userKey = ["user", username];
    await kv.set(userKey, { password: hash, name, surname, email, cell, status: "pending" });
    await sendSignupEmail({ to: "drewbt@gmail.com", name: name + ' ' + surname, username, email, cell, fileName, base64: fileData });
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

  // SERVE EMBEDDED HTML
  if (path === "/" && req.method === "GET") {
    return new Response(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Sifunastena</title>
  <style>
    body { background: #111; color: #fff; font-family: sans-serif; padding: 2rem; }
    input, button { display: block; margin: 0.5rem 0; padding: 0.5rem; width: 100%; max-width: 300px; }
    button { background: teal; color: white; border: none; cursor: pointer; }
  </style>
</head>
<body>
  <div class="screen" id="signup">
    <h2>Create Account</h2>
    <input id="name" placeholder="Full Name" />
    <input id="surname" placeholder="Surname" />
    <input id="email" placeholder="Email" type="email" />
    <input id="cell" placeholder="Cell Number" />
    <input id="username" placeholder="Username" />
    <input id="password" type="password" placeholder="Password" />
    <input id="doc" type="file" accept=".pdf,.png,.jpg,.jpeg" />
    <button onclick="uploadDoc()">Submit</button>
  </div>
  <script>
    async function uploadDoc() {
      const file = document.getElementById('doc').files[0];
      const reader = new FileReader();
      reader.onload = async function () {
        const base64 = reader.result.split(',')[1];
        const payload = {
          name: document.getElementById('name').value,
          surname: document.getElementById('surname').value,
          email: document.getElementById('email').value,
          cell: document.getElementById('cell').value,
          username: document.getElementById('username').value,
          password: document.getElementById('password').value,
          fileName: file.name,
          fileData: base64
        };
        const res = await fetch('/submit-doc', {
          method: 'POST',
          body: JSON.stringify(payload)
        });
        const data = await res.json();
        alert(data.ok ? 'Submitted. Await confirmation.' : 'Submission failed.');
      };
      reader.readAsDataURL(file);
    }
  </script>
</body>
</html>`, {
      headers: { "content-type": "text/html" }
    });
  }

  return new Response("Not found", { status: 404 });
});
