import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/auth/login")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { json, publishableClient } = await import("@/lib/knowhow-api.server");
        const { email, password } = await request.json().catch(() => ({}));
        if (!email || !password) return json({ message: "Email and password required" }, 400);
        const pub = publishableClient();
        const { data, error } = await pub.auth.signInWithPassword({ email, password });
        if (error || !data.session) return json({ message: error?.message || "Invalid credentials" }, 401);
        return json({ token: data.session.access_token });
      },
    },
  },
});
