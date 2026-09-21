import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { getUser } from "@/lib/auth";
import { BrainMapClient } from "./BrainMapClient";

export const metadata: Metadata = { title: "Brain map · Practiscale" };

export const dynamic = "force-dynamic";

/**
 * /brain — the Brain map: what the Brain knows, by intelligence class and
 * domain, with every object openable in the drawer. Lives in the (app) group so
 * it inherits the chat chrome. Auth is enforced by the group layout and
 * re-checked here; the data is loaded client-side from /api/brain/knowledge
 * (which resolves the sensitive flag from the session server-side).
 */
export default async function BrainMapPage() {
  const user = await getUser();
  if (!user) redirect("/login");
  return <BrainMapClient />;
}
