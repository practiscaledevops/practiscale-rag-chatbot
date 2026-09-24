"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Camera, Check, Loader2, LogOut, Pencil, X } from "lucide-react";
import { Button } from "@/components/Button";
import { IconButton } from "@/components/IconButton";
import { UserAvatar } from "@/components/UserAvatar";
import { createSupabaseBrowserClient } from "@/lib/supabase-browser";
import { removeAvatar, resetAvatarUrl, useAvatarUrl } from "@/lib/avatar-client";
import { updateDisplayName } from "./actions";
import { AvatarEditor } from "./AvatarEditor";

/** Types the picker offers; any other image the browser can decode is cropped too. */
const PHOTO_ACCEPT = "image/png,image/jpeg,image/webp";
/** Source images are cropped + re-encoded client-side, so this can be generous. */
const MAX_SOURCE_BYTES = 20 * 1024 * 1024;

export interface AccountClientProps {
  displayName: string;
  email: string | null;
  roleLabel: string;
  /** Versioned URL of the user's profile picture, or null (initials). */
  avatarUrl: string | null;
}

/**
 * The interactive identity card for the account page: the profile picture
 * (upload / change via the crop dialog / remove), an inline display-name editor
 * (saved via the updateDisplayName server action), and the sign-out control.
 * The heavier, read-only cards (access, usage) are rendered server-side by the
 * page.
 */
export function AccountClient({ displayName, email, roleLabel, avatarUrl }: AccountClientProps) {
  const router = useRouter();

  const [name, setName] = useState(displayName);
  const [draft, setDraft] = useState(displayName);
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, startSaving] = useTransition();
  const [signingOut, setSigningOut] = useState(false);

  // Profile picture.
  const currentAvatar = useAvatarUrl(avatarUrl);
  const hasAvatar = Boolean(currentAvatar);
  const fileRef = useRef<HTMLInputElement>(null);
  const uploadBtnRef = useRef<HTMLButtonElement>(null);
  const [editorFile, setEditorFile] = useState<File | null>(null);
  const [editorKey, setEditorKey] = useState(0);
  const [removing, setRemoving] = useState(false);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [photoStatus, setPhotoStatus] = useState("");
  // Guarded in the handlers rather than via `disabled`: disabling the focused
  // trigger would blur it, and the dialog restores focus to the trigger on close.
  const photoBusy = removing || editorFile !== null;

  function pickPhoto() {
    if (photoBusy) return;
    setPhotoError(null);
    fileRef.current?.click();
  }

  function onPhotoPicked(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // let the same file be picked again later
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setPhotoError("Choose an image file (PNG, JPEG or WebP).");
      return;
    }
    if (file.size > MAX_SOURCE_BYTES) {
      setPhotoError("That image is over 20 MB. Choose a smaller one.");
      return;
    }
    setPhotoError(null);
    setEditorKey((k) => k + 1);
    setEditorFile(file);
  }

  function onPhotoSaved() {
    setEditorFile(null);
    setPhotoStatus("Profile picture updated.");
    router.refresh();
  }

  async function removePhoto() {
    if (photoBusy) return;
    setRemoving(true);
    setPhotoError(null);
    const res = await removeAvatar();
    setRemoving(false);
    if ("error" in res) {
      setPhotoError(res.error);
      return;
    }
    setPhotoStatus("Profile picture removed.");
    // The Remove button (which had focus) is gone now; keep focus in the card.
    uploadBtnRef.current?.focus();
    router.refresh();
  }

  function startEdit() {
    setDraft(name);
    setError(null);
    setEditing(true);
  }

  function cancelEdit() {
    setEditing(false);
    setError(null);
  }

  function save() {
    const trimmed = draft.trim();
    if (!trimmed) {
      setError("Enter a name");
      return;
    }
    if (trimmed === name) {
      setEditing(false);
      return;
    }
    setError(null);
    startSaving(async () => {
      const result = await updateDisplayName({ displayName: trimmed });
      if (result.ok) {
        setName(result.displayName);
        setEditing(false);
        router.refresh();
      } else {
        setError(result.error);
      }
    });
  }

  async function signOut() {
    setSigningOut(true);
    try {
      const supabase = createSupabaseBrowserClient();
      await supabase.auth.signOut();
    } catch {
      /* fall through to the login redirect even if the network call fails */
    } finally {
      // Soft navigation keeps module state alive — drop the published avatar
      // so the next account to sign in on this tab never sees this one's.
      resetAvatarUrl();
      router.replace("/login");
      router.refresh();
    }
  }

  return (
    <section className="rounded-2xl border border-border bg-surface p-4 shadow-soft">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-center gap-3.5">
          <div className="relative shrink-0">
            <UserAvatar
              name={name}
              email={email}
              avatarUrl={avatarUrl}
              size={56}
              className="shadow-soft"
            />
            <button
              type="button"
              onClick={pickPhoto}
              aria-disabled={removing || undefined}
              aria-label="Change profile picture"
              title="Change profile picture"
              className="absolute -bottom-0.5 -right-0.5 grid h-6 w-6 place-items-center rounded-full border-2 border-surface bg-accent text-accent-foreground shadow-soft transition-colors hover:bg-accent-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-surface aria-disabled:opacity-60"
            >
              <Camera size={12} strokeWidth={2.25} />
            </button>
            <input
              ref={fileRef}
              type="file"
              accept={PHOTO_ACCEPT}
              onChange={onPhotoPicked}
              className="hidden"
              tabIndex={-1}
              aria-hidden
            />
          </div>

          <div className="min-w-0">
            {editing ? (
              <div className="space-y-2">
                <label htmlFor="display-name" className="sr-only">
                  Display name
                </label>
                <div className="flex items-center gap-2">
                  <input
                    id="display-name"
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        save();
                      } else if (e.key === "Escape") {
                        cancelEdit();
                      }
                    }}
                    autoFocus
                    maxLength={120}
                    disabled={saving}
                    className="h-9 w-full max-w-xs rounded-xl border border-border bg-surface px-3 text-sm outline-none transition-colors placeholder:text-subtle-foreground focus-visible:border-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30 disabled:cursor-not-allowed disabled:opacity-60"
                  />
                  <Button
                    type="button"
                    size="sm"
                    onClick={save}
                    disabled={saving || !draft.trim()}
                    aria-label="Save name"
                    className="h-9 shrink-0 px-3.5 text-[13px]"
                  >
                    {saving ? (
                      <Loader2 size={14} className="animate-spin" />
                    ) : (
                      <Check size={14} />
                    )}
                    Save
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={cancelEdit}
                    disabled={saving}
                    aria-label="Cancel"
                    className="h-9 w-9 shrink-0 px-0"
                  >
                    <X size={14} />
                  </Button>
                </div>
                {error && (
                  <p role="alert" className="text-xs text-danger">
                    {error}
                  </p>
                )}
              </div>
            ) : (
              <>
                <div className="flex items-center gap-2">
                  <h2 className="truncate text-[15px] font-semibold tracking-tight">
                    {name}
                  </h2>
                  <IconButton
                    type="button"
                    size="sm"
                    onClick={startEdit}
                    aria-label="Edit display name"
                    className="shrink-0"
                  >
                    <Pencil size={14} />
                  </IconButton>
                </div>
                <p className="truncate text-[13px] text-muted-foreground">{email}</p>
                <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="inline-flex items-center rounded-full bg-accent-soft px-2 py-0.5 text-[11px] font-medium leading-4 text-accent-strong">
                    {roleLabel}
                  </span>
                  <span aria-hidden className="h-3.5 w-px bg-border" />
                  <div className="-ml-1 flex items-center">
                    <button
                      ref={uploadBtnRef}
                      type="button"
                      onClick={pickPhoto}
                      aria-disabled={removing || undefined}
                      className="inline-flex h-7 items-center rounded-lg px-2 text-[13px] font-medium text-accent-strong transition-colors hover:bg-accent-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring aria-disabled:opacity-50"
                    >
                      {hasAvatar ? "Change photo" : "Upload photo"}
                    </button>
                    {hasAvatar && (
                      <button
                        type="button"
                        onClick={removePhoto}
                        aria-disabled={removing || undefined}
                        aria-busy={removing || undefined}
                        className="inline-flex h-7 items-center gap-1.5 rounded-lg px-2 text-[13px] font-medium text-muted-foreground transition-colors hover:bg-surface-muted hover:text-danger focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring aria-disabled:opacity-50"
                      >
                        {removing && <Loader2 size={12} className="animate-spin" />}
                        Remove
                      </button>
                    )}
                  </div>
                </div>
              </>
            )}
            {photoError && (
              <p role="alert" className="mt-1.5 text-xs text-danger">
                {photoError}
              </p>
            )}
            <p role="status" className="sr-only">
              {photoStatus}
            </p>
          </div>
        </div>

        <div className="shrink-0">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={signOut}
            disabled={signingOut}
          >
            {signingOut ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <LogOut size={14} />
            )}
            Sign out
          </Button>
        </div>
      </div>

      {editorFile && (
        <AvatarEditor
          key={editorKey}
          file={editorFile}
          onClose={() => setEditorFile(null)}
          onSaved={onPhotoSaved}
        />
      )}
    </section>
  );
}
