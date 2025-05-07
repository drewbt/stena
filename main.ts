// main.ts

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

const kv = await Deno.openKv();
const sockets = new Map<string, Set<WebSocket>>();
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");

serve(async (req) => {
  const url = new URL(req.url);

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

  return new Response("Not Found", { status: 404 });
});

function renderLogin(message = "") {
  const script = JSON.stringify(`
    (() => {
      const ws = new WebSocket('ws://' + location.host + '/ws');
      ws.onmessage = e => document.body.innerHTML = e.data;
      window.login = () => {
        const email = document.getElementById('email').value;
        const password = document.getElementById('password').value;
        ws.send(JSON.stringify({ type: 'login', email, password }));
      };
      window.showSignup = () => {
        document.body.innerHTML = \
          '<div style="text-align:center;padding:2em;">' +
          '<h1 style="font-size:5em; color:gold;">Ϡ</h1>' +
          '<input id="name" placeholder="First Name" style="width:100%;margin:0.5em;padding:0.5em;" />' +
          '<input id="surname" placeholder="Surname" style="width:100%;margin:0.5em;padding:0.5em;" />' +
          '<input id="cell" placeholder="Cell Number" style="width:100%;margin:0.5em;padding:0.5em;" />' +
          '<input id="email" placeholder="Email" style="width:100%;margin:0.5em;padding:0.5em;" />' +
          '<input id="password" type="password" placeholder="Password" style="width:100%;margin:0.5em;padding:0.5em;" />' +
          '<button onclick="signup()" style="width:100%;padding:0.75em;background:green;color:white;border:none;">Submit</button>' +
          '</div>' +
          '<script>' +
          'window.signup = () => {' +
          ' const data = {' +
          '   type: "signup",' +
          '   name: document.getElementById("name").value,' +
          '   surname: document.getElementById("surname").value,' +
          '   cell: document.getElementById("cell").value,' +
          '   email: document.getElementById("email").value,' +
          '   password: document.getElementById("password").value,' +
          '   idb64: btoa("dummy-id")' +
          ' };' +
          ' ws.send(JSON.stringify(data));' +
          '};' +
          '<\/script>';
      };
    })();
  `);
  return `
    <div style='text-align:center; padding:2em;'>
      <h1 style='font-size:5em; color:gold;'>Ϡ</h1>
      <input id='email' placeholder='Email' style='width:100%;margin:0.5em;padding:0.5em;' />
      <input id='password' type='password' placeholder='Password' style='width:100%;margin:0.5em;padding:0.5em;' />
      <button onclick='login()' style='width:100%;padding:0.75em;background:navy;color:white;border:none;'>Log In</button>
      <button onclick='showSignup()' style='width:100%;padding:0.75em;background:#004;color:white;border:none;margin-top:0.5em;'>Sign Up</button>
      <div id='message' style='margin-top:1em;color:red;'>${message}</div>
    </div>
    <script>
      eval(${script});
    </script>`;
}

function renderMain(user) {
  const script = JSON.stringify(`
    (() => {
      const ws = new WebSocket('ws://' + location.host + '/ws');
      ws.onmessage = e => document.body.innerHTML = e.data;
      window.sendTx = () => {
        const to = document.getElementById('to').value;
        const amount = parseFloat(document.getElementById('amount').value);
        const message = document.getElementById('message').value;
        ws.send(JSON.stringify({ type: 'send', from: '${user.email}', to, amount, message }));
      };
    })();
  `);
  return `
    <div style='text-align:center;padding:2em;'>
      <h1 style='font-size:5em; color:gold;'>Ϡ</h1>
      <div style='font-size:2em;'>Ϡ${user.balance}</div>
      <p>Welcome, ${user.name}</p>
      <input id='to' placeholder='Recipient Email' style='width:100%;margin:0.5em;padding:0.5em;' />
      <input id='amount' type='number' placeholder='Amount' style='width:100%;margin:0.5em;padding:0.5em;' />
      <input id='message' placeholder='Message (optional)' style='width:100%;margin:0.5em;padding:0.5em;' />
      <button onclick='sendTx()' style='width:100%;padding:0.75em;background:navy;color:white;border:none;'>Send</button>
    </div>
    <script>
      eval(${script});
    </script>`;
}
