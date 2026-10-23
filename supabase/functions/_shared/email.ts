// Transactional email through Resend (https://resend.com), for alerts to the FLOQQ team. Needs the
// RESEND_API_KEY secret; RESEND_FROM sets the sender - until FLOQQ's own domain is verified with
// Resend, its test sender only delivers to the address the Resend account was made with. Never
// throws: an alert that can't be sent is logged, it never blocks what triggered it.

export async function sendEmail(message: { to: string; subject: string; text: string }): Promise<boolean> {
  const apiKey = Deno.env.get('RESEND_API_KEY');
  if (!apiKey) {
    console.warn(`Email not sent (RESEND_API_KEY is not set): ${message.subject}`);
    return false;
  }
  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: Deno.env.get('RESEND_FROM') ?? 'FLOQQ Support <onboarding@resend.dev>',
        to: [message.to],
        subject: message.subject,
        text: message.text,
      }),
    });
    if (!response.ok) {
      console.error(`Email not sent (${response.status}): ${await response.text()}`);
      return false;
    }
    return true;
  } catch (err) {
    console.error('Email not sent', err);
    return false;
  }
}
