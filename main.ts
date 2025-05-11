// main.ts (for Deno Deploy - Secure Password Handling Example)

import { serve } from "https://deno.land/std@0.224.2/http/server.ts";
// Importing bcrypt for secure password hashing
import * as bcrypt from "https://deno.land/x/bcrypt@v0.4.1/mod.ts";

// Initialize Deno KV
const kv = await Deno.openKv();

// --- Constants and Configuration ---
const BASIC_ALLOCATION_UNITS = 50;
const UNITS_TO_PARTS_MULTIPLIER = 1000;
const BASIC_ALLOCATION_PARTS = BASIC_ALLOCATION_UNITS * UNITS_TO_PARTS_MULTIPLIER; // 50000 parts

// Note: In a real system, monthly allocation would be tied to a calendar month.
// For this simplified example, we'll use a simple timestamp check.
const ONE_MONTH_MS = 30 * 24 * 60 * 60 * 1000; // Approximation of a month in milliseconds

// --- Helper Functions ---

// Generates a simple unique user ID (in real system, this would be tied to verification)
function generateUserId(username: string): string {
    // In a real system, this needs to be robust and tied to verified identity
    return "user_" + username.toLowerCase().replace(/\s+/g, '_');
}

// Gets user data from KV
async function getUser(userId: string): Promise<any | null> {
    const user = await kv.get(["users", userId]);
    return user.value;
}

// Saves user data to KV
async function saveUser(userId: string, userData: any): Promise<void> {
    await kv.set(["users", userId], userData);
}

// Gets transactions for a user
async function getUserTransactions(userId: string): Promise<any[]> {
    const iter = kv.list({ prefix: ["transactions", userId] });
    const transactions = [];
    for await (const entry of iter) {
        transactions.push(entry.value);
    }
    // Sort by timestamp for display order (protobuf appended naturally gives order, but fetching might mix)
    transactions.sort((a, b) => a.timestamp - b.timestamp);
    return transactions;
}

// Records a transaction (simplified Protocol Buffer concept - using JS objects)
async function recordTransaction(fromUserId: string, toUserId: string, amountParts: number, type: 'allocation' | 'send' | 'receive'): Promise<void> {
    const transaction = {
        id: crypto.randomUUID(), // Unique transaction ID
        from: fromUserId,
        to: toUserId,
        amount_parts: amountParts,
        type: type, // 'allocation', 'send', 'receive' (from 'to' user perspective)
        timestamp: Date.now(), // Using timestamp for "appended to stack" order
        // In a real system, this would be serialized protobuf binary data
        // For this demo, it's a JS object stored in KV
    };

    // Store transaction, potentially indexed by both from and to users for easy lookup
    // Using timestamp as part of the key for implicit ordering
    await kv.set(["transactions", fromUserId, transaction.timestamp + "_out"], transaction);
    await kv.set(["transactions", toUserId, transaction.timestamp + "_in"], transaction);
}

// --- HTML Templates (Vanilla HTML) ---

function htmlLayout(title: string, content: string, user?: any): string {
    return `
<!DOCTYPE html>
<html>
<head>
    <title>${title}</title>
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <style>
        body { font-family: sans-serif; line-height: 1.6; margin: 20px; }
        nav a { margin-right: 15px; }
        .container { max-width: 800px; margin: auto; }
        form div { margin-bottom: 15px; }
        label { display: block; margin-bottom: 5px; font-weight: bold; }
        input[type="text"], input[type="password"], input[type="number"] {
            width: calc(100% - 22px); padding: 10px; border: 1px solid #ccc;
        }
        button { padding: 10px 15px; background-color: #007bff; color: white; border: none; cursor: pointer; }
        button:hover { background-color: #0056b3; }
        .transaction { border-bottom: 1px solid #eee; padding: 10px 0; }
        .transaction:last-child { border-bottom: none; }
        .error { color: red; font-weight: bold; }
    </style>
</head>
<body>
    <div class="container">
        <h1>${title}</h1>
        <nav>
            <a href="/">Home</a>
            ${user ? `<a href="/dashboard">Dashboard</a> <a href="/logout">Logout</a>` : `<a href="/signup">Signup</a> <a href="/login">Login</a>`}
        </nav>
        <hr>
        ${content}
    </div>
</body>
</html>
`;
}

function homePageHTML(): string {
    return htmlLayout("Welcome to Diz (Basic Demo)", `
        <p>This is a simplified demonstration of the basic token allocation and transfer logic of the Diz system, built with Deno Deploy and Deno KV.</p>
        <p>This version demonstrates **proper password hashing** for signup and login, addressing the crucial security concern from the previous example.</p>
        <p>It illustrates:</p>
        <ul>
            <li>User Signup with Secure Password Hashing & Basic Allocation</li>
            <li>Monthly Allocation on Login (with secure password verification)</li>
            <li>Token Balance</li>
            <li>Sending Tokens to Others</li>
            <li>Basic Transaction History</li>
        </ul>
        <p>Note: This demo still skips many crucial real-world complexities like true identity verification, robust session management beyond a simple cookie, complex error handling, and the full Functional Intelligence features described in the vision.</p>
        <p><a href="/signup">Sign up</a> or <a href="/login">Log in</a> to try the basic features.</p>
    `);
}

function signupFormHTML(error?: string): string {
    return htmlLayout("Signup", `
        <p>Create your account to receive your initial basic allowance.</p>
        ${error ? `<p class="error">${error}</p>` : ''}
        <form action="/signup" method="post">
            <div>
                <label for="username">Username:</label>
                <input type="text" id="username" name="username" required>
            </div>
            <div>
                <label for="password">Password:</label>
                <input type="password" id="password" name="password" required>
            </div>
             <div>
                <label for="confirm_password">Confirm Password:</label>
                <input type="password" id="confirm_password" name="confirm_password" required>
            </div>
            <button type="submit">Sign Up</button>
        </form>
    `);
}

function loginFormHTML(error?: string): string {
    return htmlLayout("Login", `
        <p>Log in to access your dashboard and receive your monthly allowance.</p>
        ${error ? `<p class="error">${error}</p>` : ''}
        <form action="/login" method="post">
            <div>
                <label for="username">Username:</label>
                <input type="text" id="username" name="username" required>
            </div>
            <div>
                <label for="password">Password:</label>
                <input type="password" id="password" name="password" required>
            </div>
            <button type="submit">Login</button>
        </form>
    `);
}

function dashboardHTML(user: any, transactions: any[], allocationMessage: string | null): string {
    const transactionListItems = transactions.map(tx => {
        const type = tx.type === 'allocation' ? 'Received Allocation'
                   : tx.from === user.id ? `Sent to ${tx.to.replace('user_', '')}`
                   : `Received from ${tx.from.replace('user_', '')}`;
        const amount = tx.amount_parts / UNITS_TO_PARTS_MULTIPLIER;
        const sign = tx.from === user.id ? '-' : '+';
        const date = new Date(tx.timestamp).toLocaleString();
        return `<div class="transaction"><strong>${type}:</strong> ${sign}${amount.toFixed(3)} units on ${date}</div>`;
    }).join('');

    return htmlLayout("Dashboard", `
        ${allocationMessage ? `<p style="color: green; font-weight: bold;">${allocationMessage}</p>` : ''}
        <h2>Your Account (${user.username})</h2>
        <p>Your Balance: <strong>${(user.balance_parts / UNITS_TO_PARTS_MULTIPLIER).toFixed(3)}</strong> units (${user.balance_parts} parts)</p>

        <h3>Send Allowance</h3>
        <form action="/send" method="post">
            <input type="hidden" name="fromUserId" value="${user.id}">
             <div>
                <label for="recipientUsername">Recipient Username:</label>
                <input type="text" id="recipientUsername" name="recipientUsername" required>
            </div>
            <div>
                <label for="amountUnits">Amount to Send (Units):</label>
                <input type="number" id="amountUnits" name="amountUnits" step="0.001" min="0.001" required>
                <small>Enter amount in units (e.g., 0.005 for 5 parts)</small>
            </div>
            <button type="submit">Send Tokens</button>
        </form>

        <h3>Transaction River</h3>
        <div id="transaction-list">
            ${transactionListItems.length > 0 ? transactionListItems : '<p>No transactions yet.</p>'}
        </div>
    `, user);
}

function sendResultHTML(message: string, success: boolean, user: any): string {
    return htmlLayout("Send Result", `
        <p style="color: ${success ? 'green' : 'red'}; font-weight: bold;">${message}</p>
        <p><a href="/dashboard">Go back to Dashboard</a></p>
    `, user);
}


// --- Request Handler ---

async function handler(req: Request): Promise<Response> {
    const url = new URL(req.url);

    // Basic routing and state handling (using cookies for simplicity in demo)
    let userId = req.headers.get("cookie")?.split('; ').find(row => row.startsWith('user_id='))?.split('=')[1];
    let user = userId ? await getUser(userId) : null;
    let allocationMessage: string | null = null; // Message for monthly allocation


    // --- Handle Routes ---

    if (url.pathname === "/" && req.method === "GET") {
        return new Response(homePageHTML(), {
            headers: { "content-type": "text/html" },
        });

    } else if (url.pathname === "/signup" && req.method === "GET") {
         if (user) return Response.redirect(new URL('/dashboard', req.url).toString(), 302);
        return new Response(signupFormHTML(), {
            headers: { "content-type": "text/html" },
        });

    } else if (url.pathname === "/signup" && req.method === "POST") {
        if (user) return Response.redirect(new URL('/dashboard', req.url).toString(), 302);

        const formData = await req.formData();
        const username = formData.get("username")?.toString();
        const password = formData.get("password")?.toString();
        const confirmPassword = formData.get("confirm_password")?.toString();


        if (!username || !password || !confirmPassword) {
             return new Response(signupFormHTML("Username, password, and confirmation are required."), {
                headers: { "content-type": "text/html" }, status: 400
            });
        }
         if (password !== confirmPassword) {
             return new Response(signupFormHTML("Passwords do not match."), {
                headers: { "content-type": "text/html" }, status: 400
            });
        }

        const newUserId = generateUserId(username);
        const existingUser = await getUser(newUserId);

        if (existingUser) {
             return new Response(signupFormHTML(`Username '${username}' already exists.`), {
                headers: { "content-type": "text/html" }, status: 400
            });
        }

        // --- CORRECT WAY: Hash the password ---
        const hashedPassword = await bcrypt.hash(password);
        // --- End of Correct Way ---


        // Create user and allocate initial basic needs tokens
        user = {
            id: newUserId,
            username: username,
            password_hash: hashedPassword, // Store the hash
            balance_parts: BASIC_ALLOCATION_PARTS, // Initial allocation
            last_allocation_timestamp: Date.now(), // Record time of first allocation
        };
        await saveUser(user.id, user);

        // Record the initial allocation transaction
        await recordTransaction("system", user.id, BASIC_ALLOCATION_PARTS, 'allocation');

        // Set a cookie to keep the user logged in for this demo
        const headers = new Headers();
        headers.set("content-type", "text/html");
        headers.set("Set-Cookie", `user_id=${user.id}; Path=/; HttpOnly`);

        // Redirect to dashboard after signup
         return Response.redirect(new URL('/dashboard', req.url).toString(), 302);


    } else if (url.pathname === "/login" && req.method === "GET") {
         if (user) return Response.redirect(new URL('/dashboard', req.url).toString(), 302);
        return new Response(loginFormHTML(), {
            headers: { "content-type": "text/html" },
        });

    } else if (url.pathname === "/login" && req.method === "POST") {
         if (user) return Response.redirect(new URL('/dashboard', req.url).toString(), 302);

        const formData = await req.formData();
        const username = formData.get("username")?.toString();
        const password = formData.get("password")?.toString();

        if (!username || !password) {
             return new Response(loginFormHTML("Username and password are required."), {
                headers: { "content-type": "text/html" }, status: 400
            });
        }

        const loginUserId = generateUserId(username);
        user = await getUser(loginUserId);

        if (!user) {
            return new Response(loginFormHTML("Invalid username or password."), {
                headers: { "content-type": "text/html" }, status: 401
            });
        }

        // --- CORRECT WAY: Compare password against the stored hash ---
        const passwordMatch = await bcrypt.compare(password, user.password_hash);

        if (!passwordMatch) {
            return new Response(loginFormHTML("Invalid username or password."), {
                headers: { "content-type": "text/html" }, status: 401
            });
        }
         // --- End of Correct Way ---


        // Check for monthly allocation on first login of the month
        if (Date.now() - user.last_allocation_timestamp > ONE_MONTH_MS) {
            user.balance_parts += BASIC_ALLOCATION_PARTS;
            user.last_allocation_timestamp = Date.now();
            await saveUser(user.id, user);
            await recordTransaction("system", user.id, BASIC_ALLOCATION_PARTS, 'allocation');
            allocationMessage = "Monthly allowance received!";
        }

        // Set a cookie to keep the user logged in for this demo
        const headers = new Headers();
        headers.set("content-type", "text/html");
        headers.set("Set-Cookie", `user_id=${user.id}; Path=/; HttpOnly`);

         // Redirect to dashboard after login
        // Pass message via URL param for simplicity in demo, normally handle server-side
         const redirectUrl = new URL('/dashboard', req.url);
         if(allocationMessage) redirectUrl.searchParams.set('msg', encodeURIComponent(allocationMessage));
         return Response.redirect(redirectUrl.toString(), 302);


    } else if (url.pathname === "/logout" && req.method === "GET") {
        const headers = new Headers();
        headers.set("Set-Cookie", `user_id=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT`); // Clear cookie
        headers.set("location", "/"); // Redirect to home
        return new Response(null, { status: 302, headers });

    } else if (url.pathname === "/dashboard" && req.method === "GET") {
        if (!user) return Response.redirect(new URL('/login', req.url).toString(), 302); // Redirect to login if not logged in

        const transactions = await getUserTransactions(user.id);

        // Check for allocation message passed from login redirect
        const msg = url.searchParams.get('msg');
        if (msg) allocationMessage = decodeURIComponent(msg);


        return new Response(dashboardHTML(user, transactions, allocationMessage), {
            headers: { "content-type": "text/html" },
        });

    } else if (url.pathname === "/send" && req.method === "POST") {
        if (!user) return Response.redirect(new URL('/login', req.url).toString(), 302); // Redirect to login if not logged in

        const formData = await req.formData();
        const recipientUsername = formData.get("recipientUsername")?.toString();
        const amountUnits = parseFloat(formData.get("amountUnits")?.toString() || '0');
        const amountParts = Math.round(amountUnits * UNITS_TO_PARTS_MULTIPLIER); // Convert units to parts

        let message = "";
        let success = false;

        if (!recipientUsername || amountUnits <= 0 || !Number.isInteger(amountParts) || amountParts <= 0) {
            message = "Invalid recipient or amount.";
        } else {
            const recipientUserId = generateUserId(recipientUsername);
            const recipient = await getUser(recipientUserId);

            if (!recipient) {
                message = `Recipient '${recipientUsername}' not found.`;
            } else if (user.balance_parts < amountParts) {
                message = `Insufficient balance. You have ${(user.balance_parts / UNITS_TO_PARTS_MULTIPLIER).toFixed(3)} units.`;
            } else {
                // Perform the transfer
                user.balance_parts -= amountParts;
                recipient.balance_parts += amountParts;

                // Use a transaction to ensure both updates succeed or fail together
                const ok = await kv.atomic()
                    .mutate(
                        { key: ["users", user.id], value: user },
                        { key: ["users", recipient.id], value: recipient }
                    )
                    .commit();

                if (ok.ok) {
                    // Record transactions after successful balance update
                    await recordTransaction(user.id, recipient.id, amountParts, 'send');
                    message = `Successfully sent ${amountUnits.toFixed(3)} units to ${recipientUsername}.`;
                    success = true;
                } else {
                    message = "Transaction failed (atomic commit error).";
                }
            }
        }

        return new Response(sendResultHTML(message, success, user), {
            headers: { "content-type": "text/html" },
        });


    } else {
        // Handle 404 Not Found
        return new Response(htmlLayout("Not Found", `
            <p>The page you requested could not be found.</p>
            <p><a href="/">Go to Home</a></p>
        `), {
            status: 404,
            headers: { "content-type": "text/html" },
        });
    }
}

serve(handler);
