"use server";

// Server action for the account page: update the signed-in user's OWN
// display name.
//
// SECURITY: the user is resolved from the verified Supabase session (getUser),
// never from an argument, and the write goes through the session-bound (RLS)
// client scoped to their own profile row (auth.uid() = id). The database further
// restricts end-user UPDATE on public.profiles to the display_name column only
// (see supabase migration 0003 / admin.sql), so this action can NEVER be
// repurposed to change role, permissions, team, or activation — those are
// service-role-only writes.

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getUser } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase-server";

const DisplayNameSchema = z.object({
  displayName: z.string().trim().min(1, "Enter a name").max(120, "Name is too long"),
});

export type UpdateDisplayNameResult =
  | { ok: true; displayName: string }
  | { ok: false; error: string };

export async function updateDisplayName(
  raw: z.infer<typeof DisplayNameSchema>
): Promise<UpdateDisplayNameResult> {
  const user = await getUser();
  if (!user) return { ok: false, error: "unauthorized" };

  const parsed = DisplayNameSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid name" };
  }
  const displayName = parsed.data.displayName;

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from("profiles")
    .update({ display_name: displayName })
    .eq("id", user.id); // belt-and-braces alongside RLS (auth.uid() = id)

  if (error) return { ok: false, error: "Could not save your name." };

  // Refresh the account page and the app shell (the greeting reads the name).
  revalidatePath("/account");
  revalidatePath("/", "layout");
  return { ok: true, displayName };
}
