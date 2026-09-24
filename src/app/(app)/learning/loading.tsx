// Skeleton for the learnings page while the route resolves.

export default function LearningLoading() {
  return (
    <div className="h-full overflow-y-auto bg-background" aria-busy>
      <div className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6">
        <div className="h-7 w-44 animate-pulse rounded-full bg-surface-muted" />
        <div className="mt-2 h-4 w-80 max-w-full animate-pulse rounded-full bg-surface-muted" />
        <div className="mt-5 flex gap-2">
          <div className="h-10 w-36 animate-pulse rounded-xl bg-surface-muted" />
          <div className="h-10 w-36 animate-pulse rounded-xl bg-surface-muted" />
        </div>
        <div className="mt-4 space-y-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-24 animate-pulse rounded-2xl bg-surface-muted" />
          ))}
        </div>
      </div>
    </div>
  );
}
