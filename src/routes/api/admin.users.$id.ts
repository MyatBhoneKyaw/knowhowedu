import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/admin/users/$id")({
  server: {
    handlers: {
      DELETE: async ({ request, params }) => {
        const { json, requireAdmin, adminClient } = await import(
          "@/lib/knowhow-api.server"
        );
        await requireAdmin(request);
        const admin = adminClient();
        const { error } = await admin.auth.admin.deleteUser(params.id);
        if (error) return json({ message: error.message }, 400);
        return json({ ok: true });
      },
      PATCH: async ({ request, params }) => {
        const { json, requireAdmin, adminClient } = await import(
          "@/lib/knowhow-api.server"
        );
        await requireAdmin(request);
        const body = await request.json().catch(() => ({}));
        const admin = adminClient();
        const updates: {
          is_suspended?: boolean;
          full_name?: string;
          raw_role?: string;
        } = {};
        if (typeof body.suspend === "boolean") updates.is_suspended = body.suspend;
        if (typeof body.fullName === "string") updates.full_name = body.fullName;
        if (typeof body.role === "string") updates.raw_role = body.role;
        if (!Object.keys(updates).length) return json({ ok: true });
        const { data, error } = await admin
          .from("profiles")
          .update(updates)
          .eq("id", params.id)
          .select("*")
          .maybeSingle();
        if (error) return json({ message: error.message }, 400);
        return json(data);
      },
    },
  },
});
