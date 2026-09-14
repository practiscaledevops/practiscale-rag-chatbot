import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { getUser } from "@/lib/auth";
import { MyApprovalsClient } from "./MyApprovalsClient";

export const metadata: Metadata = { title: "My approvals · Practiscale" };

export const dynamic = "force-dynamic";

/**
 * /approvals — the signed-in user's own submissions and their review status.
 * Lives in the (app) group so it inherits the chat chrome. Auth is enforced by
 * the group layout and re-checked here; the data (RLS-scoped to the caller) is
 * loaded client-side from /api/approvals.
 */
export default async function MyApprovalsPage() {
  const user = await getUser();
  if (!user) redirect("/login");
  return <MyApprovalsClient />;
}
