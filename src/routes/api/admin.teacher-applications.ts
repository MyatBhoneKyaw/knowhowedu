import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/admin/teacher-applications")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { json, requireAdmin, adminClient, shapeApplication } = await import(
          "@/lib/knowhow-api.server"
        );
        await requireAdmin(request);
        const admin = adminClient();
        const { data, error } = await admin
          .from("teacher_applications")
          .select("*")
          .order("created_at", { ascending: false });
        if (error) return json({ message: error.message }, 400);
        const userIds = Array.from(new Set((data || []).map((a) => a.user_id)));
        const { data: profiles } = userIds.length
          ? await admin.from("profiles").select("id, full_name, username, email").in("id", userIds)
          : { data: [] as any[] };
        const byId = new Map((profiles || []).map((p) => [p.id, p]));
        const merged = (data || []).map((a) => ({ ...a, user: byId.get(a.user_id) }));
        return json(merged.map(shapeApplication));
      },
    },
  },
});
