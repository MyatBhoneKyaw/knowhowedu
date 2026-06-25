import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/admin/auth/login")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { json, publishableClient, adminClient } = await import(
          "@/lib/knowhow-api.server"
        );
        const { email, password } = await request.json().catch(() => ({}));
        if (!email || !password) return json({ message: "Email and password required" }, 400);
        const pub = publishableClient();
        const { data, error } = await pub.auth.signInWithPassword({ email, password });
        if (error || !data.session) return json({ message: error?.message || "Invalid credentials" }, 401);
        const admin = adminClient();
        const { data: isAdmin } = await admin.rpc("has_role", {
          _user_id: data.user!.id,
          _role: "admin",
        });
        if (!isAdmin) return json({ message: "Admin account only." }, 403);
        return json({ token: data.session.access_token });
      },
    },
  },
});
