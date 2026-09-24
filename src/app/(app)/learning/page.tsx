import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { getUser } from "@/lib/auth";
import { getSessionProfile } from "@/lib/admin";
import { accessFromProfile, hasCapability } from "@/lib/access";
import { isDemo } from "@/lib/demo/mode";
import { FeatureUnavailable } from "@/components/FeatureUnavailable";
import { LearningClient } from "./LearningClient";

export const metadata: Metadata = { title: "My learnings · Practiscale" };

export const dynamic = "force-dynamic";

/**
 * /learning — the learning records saved from chat ("Save as learning") and
 * reviewed in the Brain's Learning Lab. Lives in the (app) group so it inherits
 * the chat chrome; data is loaded client-side from /api/brain/learning. Needs
 * the "learning.read" capability.
 */
export default async function LearningPage() {
  const user = await getUser();
  if (!user) redirect("/login");
  if (!isDemo()) {
    const profile = await getSessionProfile(user);
    if (!profile) redirect("/login");
    if (!hasCapability(accessFromProfile(profile), "learning.read")) {
      return <FeatureUnavailable title="Learnings" message="Learnings aren't enabled for your account. Ask an admin if you need them." />;
    }
  }
  return <LearningClient />;
}
