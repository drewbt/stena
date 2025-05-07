// main.ts

import { serve } from "https://deno.land/std@0.201.0/http/server.ts";

const kv = await Deno.openKv();
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY")!;
const ADMIN_EMAIL = "drewbt@gmail.com";
const MONTHLY_ALLOWANCE = 50000;

serve(async (req) => {
  const upgrade = req.headers.get("upgrade");
  if (upgrade && upgrade.toLowerCase() === "websocket") {
    const { socket, response } = Deno.upgradeWebSocket(req);
    socket.addEventListener("open", () => renderLogin(socket));
    socket.addEventListener("message", (e) => handleMessage(socket, e.data));
    return response;
  }

  return new Response(`<!DOCTYPE html>
    <html><head><style>${sharedStyles()}</style></head>
    <body>
      <script>
        const socket = new WebSocket(location.href.replace('http', 'ws'));
        socket.onmessage = e => document.body.innerHTML = e.data;
        window.socket = socket;
      </script>
    </body></html>`, {
    headers: { "Content-Type": "text/html" }
  });
});

function renderLogin(socket: WebSocket) {
  socket.send(`<!DOCTYPE html><html><head><style>${sharedStyles()}</style></head><body>
    <h1>SifunaStena</h1>
    <form onsubmit="login(event)">
      <input name="email" placeholder="Email" required />
      <input name="password" type="password" placeholder="Password" required />
      <button type="submit">Log In</button>
    </form>
    <button id="forgotBtn">Forgot Password</button>
    <button id="signupBtn">Sign Up</button>
    <script>
      const socket = window.socket || new WebSocket(location.href.replace('http', 'ws'));
      function login(e) {
        e.preventDefault();
        const form = e.target;
        socket.send(JSON.stringify({
          type: "login",
          email: form.email.value,
          password: form.password.value
        }));
      }
      document.getElementById("forgotBtn").onclick = function() {
        const email = prompt("Enter your email:");
        if (email) socket.send(JSON.stringify({ type: "forgot", email }));
      };
      document.getElementById("signupBtn").onclick = function() {
        socket.send(JSON.stringify({ type: "signup" }));
      };
    </script>
  </body></html>`);
}

async function handleLogin(socket: WebSocket, msg: any) {
  const { email, password } = msg;
  const user = await kv.get(["user", email]);
  if (!user.value || user.value.password !== hashPassword(password)) {
    socket.send(renderError("Invalid login credentials."));
    return;
  }
  if (!user.value.approved) {
    socket.send(renderError("Account pending approval."));
    return;
  }

  const txs = await kv.list({ prefix: ["tx"] });
  let txHtml = "";
  for await (const entry of txs) {
    const tx = entry.value;
    if (tx.from === email || tx.to === email) {
      txHtml += `<li>Σ${tx.amount} from ${tx.from} to ${tx.to}</li>`;
    }
  }

  socket.send(`<!DOCTYPE html><html><head><style>${sharedStyles()}</style></head><body>
    <h1>Welcome ${user.value.name}</h1>
    <p>Balance: Σ${user.value.balance}</p>
    <form onsubmit="sendMoney(event)">
      <input name="to" placeholder="Recipient Email" required />
      <input name="amount" type="number" placeholder="Amount" required />
      <button type="submit">Send</button>
    </form>
    <h2>Transactions</h2>
    <ul>${txHtml}</ul>
    <script>
      const socket = window.socket || new WebSocket(location.href.replace('http', 'ws'));
      function sendMoney(e) {
        e.preventDefault();
        const form = e.target;
        socket.send(JSON.stringify({
          type: "send",
          from: "${email}",
          to: form.to.value,
          amount: parseFloat(form.amount.value)
        }));
      }
    </script>
  </body></html>`);
}

function sharedStyles() {
  return `
    body { font-family: sans-serif; padding: 2rem; }
    form { display: flex; flex-direction: column; max-width: 300px; }
    input, button { margin: 0.5rem 0; padding: 0.5rem; }
  `;
}

function renderError(message: string) {
  return `<div style='color: red;'>Error: ${message}</div>`;
}

function hashPassword(password: string): string {
  const data = new TextEncoder().encode(password);
  const hashBuffer = crypto.subtle.digestSync("SHA-256", data);
  return Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, "0")).join("");
}

async function handleMessage(socket: WebSocket, data: string) {
  try {
    const msg = JSON.parse(data);
    switch (msg.type) {
      case "login": await handleLogin(socket, msg); break;
      case "signup": renderSignup(socket); break;
      case "submitSignup": await handleSubmitSignup(socket, msg); break;
      case "forgot": await handleForgotPassword(socket, msg); break;
      case "send": await handleSend(socket, msg); break;
      default: socket.send(renderError("Unknown message type."));
    }
  } catch (_) {
    socket.send(renderError("Invalid message format."));
  }
}

function renderSignup(socket: WebSocket) {
  socket.send(`<!DOCTYPE html><html><head><style>${sharedStyles()}</style></head><body>
    <h1>Sign Up</h1>
    <form onsubmit="submitSignup(event)">
      <input name="name" placeholder="Name" required />
      <input name="surname" placeholder="Surname" required />
      <input name="id" placeholder="ID Number" required />
      <input name="email" placeholder="Email" required />
      <input name="phone" placeholder="Phone" required />
      <input name="password" type="password" placeholder="Password" required />
      <input name="idCopy" type="file" required />
      <button type="submit">Submit</button>
    </form>
    <script>
      const socket = window.socket || new WebSocket(location.href.replace('http', 'ws'));
      function submitSignup(e) {
        e.preventDefault();
        const form = e.target;
        const reader = new FileReader();
        reader.onload = function() {
          socket.send(JSON.stringify({
            type: "submitSignup",
            name: form.name.value,
            surname: form.surname.value,
            id: form.id.value,
            email: form.email.value,
            phone: form.phone.value,
            password: form.password.value,
            idCopy: reader.result
          }));
        };
        reader.readAsDataURL(form.idCopy.files[0]);
      }
    </script>
  </body></html>`);
}

async function handleSubmitSignup(socket: WebSocket, msg: any) {
  const { email, password, ...rest } = msg;
  const user = { ...rest, email, password: hashPassword(password), balance: 0, approved: false };
  await kv.set(["user", email], user);
  await sendEmail(ADMIN_EMAIL, "New SifunaStena Signup", `New user signup for approval:<br>${email}<br><pre>${JSON.stringify(user, null, 2)}</pre>`);
  socket.send("<div>Your application has been submitted. You will receive an email once it has been approved.</div>");
}

async function handleForgotPassword(socket: WebSocket, msg: any) {
  const user = await kv.get(["user", msg.email]);
  if (!user.value) {
    socket.send(renderError("Email not registered."));
    return;
  }
  await sendEmail(msg.email, "Password Reset", `Reset instructions here.`);
  socket.send("<div>Password reset email sent.</div>");
}

async function handleSend(socket: WebSocket, msg: any) {
  const { to, amount, from } = msg;
  const sender = await kv.get(["user", from]);
  const recipient = await kv.get(["user", to]);
  if (!sender.value || !recipient.value || sender.value.balance < amount) {
    socket.send(renderError("Transfer failed."));
    return;
  }
  sender.value.balance -= amount;
  recipient.value.balance += amount;
  await kv.set(["user", from], sender.value);
  await kv.set(["user", to], recipient.value);
  await kv.set(["tx", Date.now()], { from, to, amount });
  socket.send(`<div>Sent Σ${amount} to ${to}</div>`);
}

async function sendEmail(to: string, subject: string, html: string) {
  await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${RESEND_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      from: "no-reply@sifunastena.com",
      to,
      subject,
      html
    })
  });
}
