import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { getUser } from "@/lib/auth";
import { getSessionProfile } from "@/lib/admin";
import { accessFromProfile, hasCapability } from "@/lib/access";
import { isDemo } from "@/lib/demo/mode";
import { FeatureUnavailable } from "@/components/FeatureUnavailable";
import { BrainMapClient } from "./BrainMapClient";

export const metadata: Metadata = { title: "Brain map · Practiscale" };

export const dynamic = "force-dynamic";

/**
 * /brain — the Brain map: what the Brain knows, by intelligence class and
 * domain, with every object openable in the drawer. Lives in the (app) group so
 * it inherits the chat chrome. Auth is enforced by the group layout and
 * re-checked here; the data is loaded client-side from /api/brain/knowledge
 * (which resolves the sensitive flag from the session server-side). Needs the
 * "knowledge.map" and "data.document" capabilities.
 */
export default async function BrainMapPage() {
  const user = await getUser();
  if (!user) redirect("/login");
  if (!isDemo()) {
    const profile = await getSessionProfile(user);
    if (!profile) redirect("/login");
    const access = accessFromProfile(profile);
    // "data.document" too: the map lists company knowledge (see /api/brain/knowledge).
    if (!hasCapability(access, "knowledge.map") || !hasCapability(access, "data.document")) {
      return <FeatureUnavailable title="Brain map" message="The Brain map isn't enabled for your account. Ask an admin if you need it." />;
    }
  }
  return <BrainMapClient />;
}
