import { CalendarDays, Play } from 'lucide-react';
import type { EpgItem } from '../lib/api';

interface LiveRecordingsDialogProps {
    open: boolean;
    title: string;
    items: EpgItem[];
    isLoading: boolean;
    onClose: () => void;
    onPlayRecording: (item: EpgItem) => void;
}

export function LiveRecordingsDialog({
    open,
    title,
    items,
    isLoading,
    onClose,
    onPlayRecording,
}: LiveRecordingsDialogProps) {
    if (!open) return null;

    return (
        <div className="fixed inset-0 z-[115] bg-black/80 backdrop-blur-sm p-4 sm:p-8 overflow-y-auto">
            <div className="max-w-3xl mx-auto rounded-2xl border border-white/10 bg-black text-white">
                <div className="px-5 py-4 border-b border-white/10 flex items-center justify-between">
                    <div>
                        <h3 className="text-lg font-semibold">Enregistrements - {title}</h3>
                        <p className="text-sm text-gray-400">Programmes passés (replay/timeshift si disponible)</p>
                    </div>
                    <button onClick={onClose} className="px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/20">
                        Fermer
                    </button>
                </div>

                <div className="p-4 space-y-3">
                    {isLoading && <p className="text-sm text-gray-400">Chargement des enregistrements...</p>}
                    {!isLoading && items.length === 0 && (
                        <p className="text-sm text-gray-400">Aucun enregistrement/replay trouvé pour cette chaîne.</p>
                    )}

                    {items.map((item, index) => (
                        <div key={`${item.start ?? index}-${item.title}`} className="rounded-xl border border-white/10 bg-white/5 p-3">
                            <div className="flex items-start justify-between gap-3">
                                <div className="min-w-0">
                                    <p className="font-medium truncate">{item.title || 'Programme'}</p>
                                    <div className="text-xs text-gray-400 mt-1 flex items-center gap-3">
                                        <span className="inline-flex items-center gap-1">
                                            <CalendarDays size={13} />
                                            {item.start ?? 'Horaire inconnu'}
                                        </span>
                                        {item.end && <span>→ {item.end}</span>}
                                    </div>
                                    {item.description && <p className="text-sm text-gray-300 mt-2 line-clamp-2">{item.description}</p>}
                                </div>
                                <button
                                    onClick={() => onPlayRecording(item)}
                                    className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-white text-black font-semibold hover:bg-gray-200"
                                >
                                    <Play size={14} fill="currentColor" />
                                    Lire
                                </button>
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
}
