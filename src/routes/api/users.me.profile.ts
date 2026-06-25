import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/users/me/profile")({
  server: {
    handlers: {
      PATCH: async ({ request }) => {
        const { json, requireUser, adminClient, shapeUser } = await import(
          "@/lib/knowhow-api.server"
        );
        const { user } = await requireUser(request);
        const body = await request.json().catch(() => ({}));
        const admin = adminClient();
        const update: Record<string, unknown> = {};
        if (body.fullName) update.full_name = body.fullName;
        if (body.username) update.username = body.username;
        if (body.email) update.email = body.email;
        if (body.profile) update.profile = body.profile;
        const { data, error } = await admin
          .from("profiles")
          .update(update)
          .eq("id", user.id)
          .select("*")
          .single();
        if (error) return json({ message: error.message }, 400);
        return json({ user: shapeUser(data) });
      },
    },
  },
});
