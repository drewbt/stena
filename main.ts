// main.ts

function renderLogin(message = "") {
  return `
    <div style='font-family:system-ui; text-align:center; padding:2em; max-width:200px; margin:auto;'>
      <div style='font-size:100px; color:gold;'>Ϡ</div>
      <input id='email' placeholder='Email' style='margin:0.5em;width:100%;padding:0.5em;font-family:system-ui;' />
      <input id='password' type='password' placeholder='Password' style='margin:0.5em;width:100%;padding:0.5em;font-family:system-ui;' />
      <button onclick='login()' style='margin:0.5em;width:100%;padding:1em;background:#001D4A;color:white;font-family:system-ui;'>Log In</button>
      <button id='signupBtn' onclick='signup()' style='display:none;margin:0.5em;width:100%;padding:1em;background:#001D4A;color:white;font-family:system-ui;'>Sign Up</button>
      <div style='margin-top:1em;color:red;'>${message}</div>
      <script>
        const ws = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws');
        ws.onmessage = e => document.body.innerHTML = e.data;
        const emailInput = document.getElementById("email");
        const passwordInput = document.getElementById("password");
        const signupBtn = document.getElementById("signupBtn");

        function checkAutoFill() {
          if (!emailInput.value && !passwordInput.value) {
            signupBtn.style.display = "block";
          } else {
            signupBtn.style.display = "none";
          }
        }
        setTimeout(checkAutoFill, 100);

        function login() {
          const email = emailInput.value;
          const password = passwordInput.value;
          ws.send(JSON.stringify({ type: "login", email, password }));
        }
        function signup() {
          const name = prompt("First Name");
          const surname = prompt("Surname");
          const cell = prompt("Cell Number");
          const email = emailInput.value;
          const password = passwordInput.value;
          const idb64 = btoa("dummy-id");
          ws.send(JSON.stringify({ type: "signup", name, surname, cell, email, password, idb64 }));
        }
      </script>
    </div>
  `;
}

function renderMain(user) {
  return `
    <div style='font-family:system-ui; text-align:center; padding:2em; max-width:200px; margin:auto;'>
      <div style='font-size:100px; color:gold;'>Ϡ</div>
      <div style='font-size:2em;'>Ϡ${user.balance}</div>
      <p>Welcome, ${user.name}</p>
      <input id='to' placeholder='Recipient Email' style='margin:0.5em;width:100%;padding:0.5em;font-family:system-ui;' />
      <input id='amount' type='number' placeholder='Amount' style='margin:0.5em;width:100%;padding:0.5em;font-family:system-ui;' />
      <input id='message' placeholder='Message (optional)' style='margin:0.5em;width:100%;padding:0.5em;font-family:system-ui;' />
      <button onclick='sendTx()' style='margin:0.5em;width:100%;padding:1em;background:#001D4A;color:white;font-family:system-ui;'>Send</button>
      <button onclick='loadTxLog()' style='margin:0.5em;width:100%;padding:1em;background:#444;color:white;font-family:system-ui;'>View Transactions</button>
      <script>
        const ws = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws');
        ws.onmessage = e => document.body.innerHTML = e.data;
        function sendTx() {
          const to = document.getElementById("to").value;
          const amount = parseFloat(document.getElementById("amount").value);
          const message = document.getElementById("message").value;
          ws.send(JSON.stringify({ type: "send", from: "${user.email}", to, amount, message }));
        }
        function loadTxLog() {
          ws.send(JSON.stringify({ type: "txlog" }));
        }
      </script>
    </div>
  `;
}

function renderTxLog(txs) {
  return `
    <div style='font-family:system-ui;padding:2em;'>
      <h2>Transaction Log</h2>
      <button onclick='location.reload()' style='margin-bottom:1em;'>Back</button>
      <div style='font-family:monospace;'>
        ${txs.map(tx => `
          <div style='margin-bottom:1em;'>
            From: <b>${tx.from}</b> → To: <b>${tx.to}</b><br/>
            Amount: Ϡ${tx.amount}<br/>
            Message: ${tx.message}<br/>
            Time: ${new Date(tx.time).toLocaleString()}
          </div>
        `).join("")}
      </div>
    </div>
  `;
}


import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

const kv = await Deno.openKv();
const sockets = new Map<string, Set<WebSocket>>();
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");

serve(async (req) => {
  const url = new URL(req.url);

  if (url.pathname === "/") {
    return new Response(`
      <!DOCTYPE html>
      <html><body style='background:black;color:white;'>
      <script>
        const ws = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws');
        ws.onmessage = e => document.body.innerHTML = e.data;
      </script>
      </body></html>
    `, { headers: { "content-type": "text/html" } });
  }

  if (url.pathname === "/ws") {
    const { socket, response } = Deno.upgradeWebSocket(req);
    let email = "";

    socket.onopen = () => {
      if (!sockets.has("_anon")) sockets.set("_anon", new Set());
      sockets.get("_anon")!.add(socket);
      socket.send(renderLogin());
    };

    socket.onmessage = async (event) => {
      const msg = JSON.parse(event.data);
      if (msg.type === "login") {
        const user = (await kv.get(["user", msg.email])).value;
        if (!user || user.password !== msg.password || !user.approved) {
          socket.send(renderLogin("Username or password not found."));
        } else {
          email = msg.email;
          if (!sockets.has(email)) sockets.set(email, new Set());
          sockets.get(email)!.add(socket);
          socket.send(renderMain(user));
        }
      } else if (msg.type === "signup") {
        const key = ["user", msg.email];
        const user = {
          name: msg.name,
          surname: msg.surname,
          cell: msg.cell,
          password: msg.password,
          idb64: msg.idb64,
          approved: false,
          balance: 0,
        };
        await kv.set(key, user);
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
            html: `Approve user <b>${msg.email}</b>? <a href='/approve?email=${msg.email}'>Approve</a>`
          })
        });
        socket.send(renderLogin("Signup submitted. Await approval."));
      } else if (msg.type === "send") {
        const fromUser = (await kv.get(["user", msg.from])).value;
        const toUser = (await kv.get(["user", msg.to])).value;
        if (!fromUser || !toUser || fromUser.balance < msg.amount) return;

        fromUser.balance -= msg.amount;
        toUser.balance += msg.amount;

        await kv.set(["user", msg.from], fromUser);
        await kv.set(["user", msg.to], toUser);

        await kv.set(["tx", Date.now()], {
          from: msg.from,
          to: msg.to,
          amount: msg.amount,
          message: msg.message,
          time: new Date().toISOString(),
        });

        for (const ws of sockets.get(msg.from) || []) ws.send(renderMain(fromUser));
        for (const ws of sockets.get(msg.to) || []) ws.send(renderMain(toUser));
      } else if (msg.type === "txlog") {
        const txs = [];
        for await (const entry of kv.list({ prefix: ["tx"] })) {
          txs.push(entry.value);
        }
        socket.send(renderTxLog(txs));
      }
    };

    socket.onclose = () => {
      sockets.get(email)?.delete(socket);
    };

    return response;
  }

  if (url.pathname === "/approve") {
    const email = url.searchParams.get("email") ?? "";
    const key = ["user", email];
    const user = (await kv.get(key)).value;
    if (!user) return new Response("User not found", { status: 404 });
    user.approved = true;
    user.balance = 50000;
    await kv.set(key, user);
    sockets.get(email)?.forEach(ws => ws.send(renderMain(user)));
    return new Response("Approved");
  }

  if (url.pathname === "/logs") {
    const logs = [];
    for await (const entry of kv.list({ prefix: ["tx"] })) {
      logs.push(entry.value);
    }
    return new Response(JSON.stringify(logs, null, 2), {
      headers: { "content-type": "application/json" },
    });
  }

  return new Response("Not Found", { status: 404 });
});
