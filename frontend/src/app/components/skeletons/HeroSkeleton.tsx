export function HeroSkeleton() {
    return (
        <div className="relative pt-4 px-2 sm:px-4">
            <div className="h-[70vh] min-h-[420px] max-h-[680px] rounded-2xl sm:rounded-3xl border border-white/10 bg-white/5 animate-pulse overflow-hidden">
                <div className="h-full flex items-end p-8 sm:p-12">
                    <div className="max-w-2xl w-full space-y-4">
                        <div className="h-6 w-32 rounded-full bg-white/10" />
                        <div className="h-10 w-3/4 rounded bg-white/10" />
                        <div className="h-4 w-full rounded bg-white/10" />
                        <div className="h-4 w-2/3 rounded bg-white/10" />
                        <div className="flex gap-3 pt-2">
                            <div className="h-12 w-32 rounded-xl bg-white/10" />
                            <div className="h-12 w-32 rounded-xl bg-white/10" />
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
