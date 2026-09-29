// Prints a Plaud user access token for PLAUD_USER_ID, for the build to start with.
// Plaud caps these at 24 hours; after that the app renews its own from the Groundwork API.
//
//   PLAUD_CLIENT_ID=… PLAUD_SECRET_KEY=… PLAUD_USER_ID=… node mint-user-token.mjs
const base = (process.env.PLAUD_BASE_URL || 'https://platform-us.plaud.ai/developer/api').replace(/\/$/, '');
const { PLAUD_CLIENT_ID: clientId, PLAUD_SECRET_KEY: secretKey, PLAUD_USER_ID: userId } = process.env;

if (!clientId || !secretKey) {
  console.error('PLAUD_CLIENT_ID and PLAUD_SECRET_KEY are required.');
  process.exit(1);
}
if (!userId || userId.length < 6 || userId.length > 120) {
  console.error('PLAUD_USER_ID must be a stable id of 6 to 120 characters.');
  process.exit(1);
}

async function post(path, headers, body) {
  const res = await fetch(`${base}${path}`, { method: 'POST', headers, body, signal: AbortSignal.timeout(30_000) });
  const text = await res.text();
  if (!res.ok) throw new Error(`Plaud ${res.status} on ${path}: ${text.slice(0, 300)}`);
  return JSON.parse(text).access_token;
}

try {
  const partner = await post('/oauth/partner/access-token', {
    Authorization: `Basic ${Buffer.from(`${clientId}:${secretKey}`).toString('base64')}`,
    'Content-Type': 'application/x-www-form-urlencoded',
  });
  const user = await post(
    '/open/partner/users/access-token',
    { Authorization: `Bearer ${partner}`, 'Content-Type': 'application/json' },
    JSON.stringify({ user_id: userId, expires_in: 86_400 }),
  );
  process.stdout.write(user);
} catch (err) {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
}
