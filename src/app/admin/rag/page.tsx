import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { requireChatbotAdmin, AdminError } from "@/lib/admin";
import { RagClient } from "./RagClient";

export const metadata: Metadata = {
  title: "RAG debugger",
};

export const dynamic = "force-dynamic";

/**
 * /admin/rag — the RAG debugger. Runs a raw retrieval against the Brain and shows
 * the chunks + reranker scores + confidence, so an admin can see what the
 * knowledge base surfaces (and why an answer was strong or weak). Server-side
 * admin gate; the data comes from /api/admin/retrieve, which re-checks the gate.
 */
export default async function AdminRagPage() {
  try {
    await requireChatbotAdmin();
  } catch (err) {
    if (err instanceof AdminError && err.status === 401) redirect("/login");
    redirect("/");
  }

  return <RagClient />;
}
