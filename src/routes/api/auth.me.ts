import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/auth/me")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { json, requireUser, adminClient, shapeUser, shapeWallet } = await import(
          "@/lib/knowhow-api.server"
        );
        const { user } = await requireUser(request).catch((r) => {
          throw r;
        });
        const admin = adminClient();
        const [{ data: profile }, { data: wallet }] = await Promise.all([
          admin.from("profiles").select("*").eq("id", user.id).single(),
          admin.from("wallets").select("*").eq("user_id", user.id).single(),
        ]);
        return json({ user: shapeUser(profile), wallet: shapeWallet(wallet) });
      },
    },
  },
});
