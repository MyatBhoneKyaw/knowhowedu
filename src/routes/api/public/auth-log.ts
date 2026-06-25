import { createFileRoute } from '@tanstack/react-router';

// Public endpoint that captures Google OAuth diagnostics from the browser
// and prints them to the server (Cloud Workers) log stream so we can
// inspect callback/token/profile failures end-to-end.
export const Route = createFileRoute('/api/public/auth-log')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        let payload: unknown = null;
        try {
          payload = await request.json();
        } catch {
          payload = { parseError: true };
        }

        const ua = request.headers.get('user-agent') || '';
        const ref = request.headers.get('referer') || '';
        const ts = new Date().toISOString();

        // Emit a single structured line so it is easy to grep in worker logs.
        // eslint-disable-next-line no-console
        console.log(
          `[google-oauth] ${ts} ref=${ref} ua=${ua} payload=${JSON.stringify(payload)}`,
        );

        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      },
      OPTIONS: async () =>
        new Response(null, {
          status: 204,
          headers: {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'POST, OPTIONS',
            'Access-Control-Allow-Headers': 'content-type',
          },
        }),
    },
  },
});
