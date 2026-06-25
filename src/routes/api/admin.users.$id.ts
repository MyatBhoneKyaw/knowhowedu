import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/admin/users/$id")({
  server: {
    handlers: {
      DELETE: async ({ request, params }) => {
        const { json, requireAdmin } = await import("@/lib/knowhow-api.server");
        try {
          await requireAdmin(request);
        } catch (e: any) {
          if (e instanceof Response) return e;
          return json({ message: e?.message || "Unauthorized" }, 401);
        }
        try {
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          // Best-effort cleanup of profile row first (auth.users CASCADE should handle the rest)
          await supabaseAdmin.from("profiles").delete().eq("id", params.id);
          const { error } = await supabaseAdmin.auth.admin.deleteUser(params.id);
          if (error) {
            console.error("[admin delete user] auth error", { id: params.id, error });
            return json({ message: `Auth delete failed: ${error.message}` }, 400);
          }
          return json({ ok: true });
        } catch (e: any) {
          console.error("[admin delete user] threw", e);
          return json({ message: e?.message || "Internal error deleting user" }, 500);
        }
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
