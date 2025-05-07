// main.ts

function sharedStyles() {
  return `
    <style>
      body { background: black; color: white; margin: 0; font-family: system-ui; }
      .wrapper { display: flex; align-items: center; justify-content: center; height: 100vh; }
      .card { text-align: center; padding: 2em; max-width: 200px; width: 100%; }
      .logo { font-size: 100px; color: gold; }
      input, button { margin: 0.5em 0; width: 100%; padding: 0.5em; font-family: system-ui; }
      .primary { background: #001D4A; color: white; padding: 1em; border: none; }
      .secondary { background: #444; color: white; padding: 1em; border: none; }
      .log { font-family: monospace; margin-top: 1em; }
      .hidden { display: none; }
    </style>
  `;
}

function renderLogin(message = "") {
  return `
    ${sharedStyles()}
    <div class="wrapper">
      <div class="card">
        <div class="logo">Ϡ</div>
        <input id='email' placeholder='Email' />
        <input id='password' type='password' placeholder='Password' />
        <button onclick='login()' class='primary'>Log In</button>
        <button id='signupBtn' onclick='signup()' class='primary hidden'>Sign Up</button>
        <div style='margin-top:1em;color:red;'>${message}</div>
        <script>
          window.onload = () => {
            const ws = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws');
            ws.onmessage = e => document.body.innerHTML = e.data;
            const emailInput = document.getElementById("email");
            const passwordInput = document.getElementById("password");
            const signupBtn = document.getElementById("signupBtn");
            function checkAutoFill() {
              if (!emailInput.value && !passwordInput.value) {
                signupBtn.classList.remove("hidden");
              } else {
                signupBtn.classList.add("hidden");
              }
            }
            setTimeout(checkAutoFill, 100);
            window.login = () => {
              const email = emailInput.value;
              const password = passwordInput.value;
              ws.send(JSON.stringify({ type: "login", email, password }));
            };
            window.signup = () => {
              const name = prompt("First Name");
              const surname = prompt("Surname");
              const cell = prompt("Cell Number");
              const email = emailInput.value;
              const password = passwordInput.value;
              const idb64 = btoa("dummy-id");
              ws.send(JSON.stringify({ type: "signup", name, surname, cell, email, password, idb64 }));
            };
          };
        </script>
      </div>
    </div>
  `;
}

function renderMain(user) {
  return `
    ${sharedStyles()}
    <div class="wrapper">
      <div class="card">
        <div class="logo">Ϡ</div>
        <div style='font-size:2em;'>Ϡ${user.balance}</div>
        <p>Welcome, ${user.name}</p>
        <input id='to' placeholder='Recipient Email' />
        <input id='amount' type='number' placeholder='Amount' />
        <input id='message' placeholder='Message (optional)' />
        <button onclick='sendTx()' class='primary'>Send</button>
        <button onclick='loadTxLog()' class='secondary'>View Transactions</button>
        <script>
          window.onload = () => {
            const ws = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws');
            ws.onmessage = e => document.body.innerHTML = e.data;
            window.sendTx = () => {
              const to = document.getElementById("to").value;
              const amount = parseFloat(document.getElementById("amount").value);
              const message = document.getElementById("message").value;
              ws.send(JSON.stringify({ type: "send", from: "${user.email}", to, amount, message }));
            };
            window.loadTxLog = () => {
              ws.send(JSON.stringify({ type: "txlog" }));
            };
          };
        </script>
      </div>
    </div>
  `;
}

function renderTxLog(txs) {
  return `
    ${sharedStyles()}
    <div style="padding:2em;">
      <h2>Transaction Log</h2>
      <button onclick='location.reload()' class='primary'>Back</button>
      <div class='log'>
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
