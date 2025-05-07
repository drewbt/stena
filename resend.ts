// resend.ts
export async function sendSignupEmail(data: {
  to: string;
  name: string;
  email: string;
  cell: string;
  username: string;
  fileName: string;
  base64: string;
}) {
  const resendKey = Deno.env.get("RESEND_API_KEY");

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${resendKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: "Sifunastena <onboarding@sifunastena.com>",
      to: data.to,
      subject: `New Signup Request from ${data.username}`,
      html: `
        <p><strong>Name:</strong> ${data.name}</p>
        <p><strong>Username:</strong> ${data.username}</p>
        <p><strong>Email:</strong> ${data.email}</p>
        <p><strong>Cell:</strong> ${data.cell}</p>
        <p>📎 ID document is attached.</p>
        <p>
          <a href="https://sifunastena.deno.dev/approve?user=${data.username}">✅ Approve</a>
          |
          <a href="https://sifunastena.deno.dev/decline?user=${data.username}">❌ Decline</a>
        </p>
      `,
      attachments: [
        {
          filename: data.fileName,
          content: data.base64,
        },
      ],
    }),
  });

  return res.json();
}
