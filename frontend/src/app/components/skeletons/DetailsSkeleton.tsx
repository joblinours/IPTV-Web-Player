export function DetailsSkeleton() {
    return (
        <div className="animate-pulse">
            <div className="h-[50vh] min-h-[320px] bg-white/5" />
            <div className="max-w-[1400px] mx-auto px-4 sm:px-6 lg:px-8 -mt-24 relative grid grid-cols-1 md:grid-cols-3 gap-8">
                <div className="aspect-[2/3] rounded-xl bg-white/10" />
                <div className="md:col-span-2 space-y-4 pt-4">
                    <div className="h-8 w-2/3 rounded bg-white/10" />
                    <div className="h-4 w-1/3 rounded bg-white/10" />
                    <div className="h-4 w-full rounded bg-white/10" />
                    <div className="h-4 w-full rounded bg-white/10" />
                    <div className="h-4 w-3/4 rounded bg-white/10" />
                </div>
            </div>
        </div>
    );
}
