import { Lock } from "lucide-react";

/**
 * Shown in place of a page whose capability the signed-in user doesn't hold
 * (e.g. the Brain map without "knowledge.map"). Server-renderable; the API
 * behind the page enforces the same capability.
 */
export function FeatureUnavailable({ title, message }: { title: string; message: string }) {
  return (
    <div className="h-full overflow-y-auto bg-background">
      <div className="mx-auto flex w-full max-w-3xl flex-col items-center px-4 py-16 text-center sm:px-6">
        <span aria-hidden className="grid h-10 w-10 place-items-center rounded-full bg-surface-muted text-muted-foreground">
          <Lock size={16} />
        </span>
        <h1 className="mt-3 text-[15px] font-semibold tracking-tight">{title}</h1>
        <p className="mt-1 max-w-sm text-[13px] text-muted-foreground">{message}</p>
      </div>
    </div>
  );
}
