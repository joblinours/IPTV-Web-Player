export function ContentRowSkeleton() {
    return (
        <div className="space-y-3">
            <div className="h-6 w-40 rounded bg-white/10 animate-pulse mx-4 sm:mx-6 lg:mx-8" />
            <div className="flex gap-4 overflow-x-hidden px-4 sm:px-6 lg:px-8">
                {Array.from({ length: 8 }).map((_, index) => (
                    <div key={index} className="flex-none w-[280px] aspect-[2/3] rounded-xl bg-white/5 animate-pulse" />
                ))}
            </div>
        </div>
    );
}
