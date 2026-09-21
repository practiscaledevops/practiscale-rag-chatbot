import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { getUser } from "@/lib/auth";
import { LearningClient } from "./LearningClient";

export const metadata: Metadata = { title: "My learnings · Practiscale" };

export const dynamic = "force-dynamic";

/**
 * /learning — the learning records saved from chat ("Save as learning") and
 * reviewed in the Brain's Learning Lab. Lives in the (app) group so it inherits
 * the chat chrome; data is loaded client-side from /api/brain/learning.
 */
export default async function LearningPage() {
  const user = await getUser();
  if (!user) redirect("/login");
  return <LearningClient />;
}
