import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/admin/teacher-applications/$id")({
  server: {
    handlers: {
      PATCH: async ({ request, params }) => {
        const { json, requireAdmin, adminClient, shapeApplication } = await import(
          "@/lib/knowhow-api.server"
        );
        await requireAdmin(request);
        const body = await request.json().catch(() => ({}));
        const admin = adminClient();
        const { data, error } = await admin
          .from("teacher_applications")
          .update({
            status: body.status || "pending",
            admin_note: body.adminNote || null,
            reviewed_at: new Date().toISOString(),
          })
          .eq("id", params.id)
          .select("*")
          .single();
        if (error) return json({ message: error.message }, 400);
        const { data: profile } = await admin
          .from("profiles")
          .select("id, full_name, username, email")
          .eq("id", data.user_id)
          .single();
        return json(shapeApplication({ ...data, user: profile }));
      },
    },
  },
});
