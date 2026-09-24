// Skeleton for the Brain map while the route resolves — mirrors the hero,
// class cards and results list so nothing jumps when the data lands.

export default function BrainMapLoading() {
  return (
    <div className="h-full overflow-y-auto bg-background" aria-busy>
      <div className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6">
        <div className="h-7 w-40 animate-pulse rounded-full bg-surface-muted" />
        <div className="mt-2 h-4 w-72 max-w-full animate-pulse rounded-full bg-surface-muted" />
        <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-5">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-[4.5rem] animate-pulse rounded-2xl bg-surface-muted" />
          ))}
        </div>
        <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-32 animate-pulse rounded-2xl bg-surface-muted" />
          ))}
        </div>
        <div className="mt-5 h-11 animate-pulse rounded-xl bg-surface-muted" />
        <div className="mt-4 space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-20 animate-pulse rounded-2xl bg-surface-muted" />
          ))}
        </div>
      </div>
    </div>
  );
}
