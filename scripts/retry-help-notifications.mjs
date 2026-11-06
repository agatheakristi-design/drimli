// Administrative use only. No secret in arguments, URLs, logs or browser code.
if (process.argv[2] !== '--send') {
  console.log('Manual retry only: provide DRIMLI_HELP_CRON_SECRET and run again with --send. One eligible notification is processed; there is no automatic loop.');
  process.exit(0);
}
const secret = process.env.DRIMLI_HELP_CRON_SECRET;
const base = new URL(process.env.DRIMLI_HELP_APP_URL || 'https://www.drimli.io');
if (!secret || base.protocol !== 'https:' || base.username || base.password || base.hostname !== 'www.drimli.io') {
  throw new Error('Missing administrative secret or invalid production URL.');
}
try {
  const response = await fetch(new URL('/api/admin/help-notifications/retry', base), {
    method: 'POST', headers: { Authorization: `Bearer ${secret}` },
    signal: AbortSignal.timeout(50_000), redirect: 'error',
  });
  const result = await response.json();
  console.log({ status: response.status, processed: result.processed, sent: result.sent, attention: result.attention });
  if (!response.ok) process.exitCode = 1;
} catch {
  console.error('Result unconfirmed. Do not retry blindly: inspect help_notifications and Resend first.');
  process.exitCode = 1;
}
