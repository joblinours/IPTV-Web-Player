import { useEffect, useState } from 'react';
import { Search, Plus, Check, Clock, Download, AlertTriangle, Trash2, Tv } from 'lucide-react';
import { useAppContext } from '../AppContext';
import {
    searchTmdb, createRequest, fetchRequests, deleteRequest,
    type TmdbSearchResultItem, type MediaRequest, type MediaRequestScope,
} from '../lib/api';

const STATUS_LABEL: Record<MediaRequest['status'], string> = {
    pending: 'En attente',
    added: 'Ajouté',
    downloading: 'Téléchargement...',
    imported: 'Importé',
    available: 'Disponible',
    failed: 'Échec',
    rejected: 'Rejeté',
};

const STATUS_ICON: Record<MediaRequest['status'], typeof Clock> = {
    pending: Clock,
    added: Clock,
    downloading: Download,
    imported: Download,
    available: Check,
    failed: AlertTriangle,
    rejected: AlertTriangle,
};

/**
 * Overseerr-style "request a movie/series" page: search TMDB, request it,
 * Radarr/Sonarr take it from there (see backend/src/routes/requests.ts).
 * Entirely new feature — no legacy state to preserve, safe to build fresh.
 */
export function RequestsPage() {
    const { isDarkMode, token, integrations } = useAppContext();
    const [type, setType] = useState<'movie' | 'series'>('movie');
    const [query, setQuery] = useState('');
    const [results, setResults] = useState<TmdbSearchResultItem[]>([]);
    const [searching, setSearching] = useState(false);
    const [requests, setRequests] = useState<MediaRequest[]>([]);
    const [pendingIds, setPendingIds] = useState<Set<number>>(new Set());
    // Series-only: which result's scope-picker (série entière / saison /
    // épisode) is currently open, and the season/episode numbers typed into
    // it. Deliberately a plain numeric input rather than fetching TMDB's
    // real season list — keeps this a request-flow addition, not a new
    // TMDB integration surface, per the scoped-down plan for this feature.
    const [expandedTmdbId, setExpandedTmdbId] = useState<number | null>(null);
    const [scopeSeason, setScopeSeason] = useState(1);
    const [scopeEpisode, setScopeEpisode] = useState(1);

    const canRequestMovies = integrations?.radarr ?? false;
    const canRequestSeries = integrations?.sonarr ?? false;

    const loadRequests = () => {
        if (!token) return;
        fetchRequests(token).then((res) => setRequests(res.items)).catch(() => {});
    };

    useEffect(() => {
        loadRequests();
    }, [token]); // eslint-disable-line react-hooks/exhaustive-deps

    useEffect(() => {
        if (!token || query.trim() === '') {
            setResults([]);
            return;
        }
        setSearching(true);
        const timer = setTimeout(() => {
            searchTmdb(token, { query, type })
                .then((res) => setResults(res.enabled ? res.results : []))
                .catch(() => setResults([]))
                .finally(() => setSearching(false));
        }, 350);
        return () => clearTimeout(timer);
    }, [token, query, type]);

    const handleRequest = async (
        result: TmdbSearchResultItem,
        scope: MediaRequestScope = 'series',
        seasonNumber?: number,
        episodeNumber?: number
    ) => {
        if (!token) return;
        setPendingIds((prev) => new Set(prev).add(result.tmdbId));
        try {
            await createRequest(token, {
                tmdbId: result.tmdbId,
                mediaType: result.mediaType === 'series' ? 'tv' : 'movie',
                title: result.title,
                year: result.year ? Number(result.year) : undefined,
                scope,
                seasonNumber,
                episodeNumber,
            });
            setExpandedTmdbId(null);
            loadRequests();
        } catch (error) {
            console.error('Request failed', error);
        } finally {
            setPendingIds((prev) => {
                const next = new Set(prev);
                next.delete(result.tmdbId);
                return next;
            });
        }
    };

    const isAlreadyRequested = (tmdbId: number, mediaType: 'movie' | 'series') =>
        requests.some((r) => r.tmdbId === tmdbId && r.mediaType === (mediaType === 'series' ? 'tv' : 'movie'));

    if (!canRequestMovies && !canRequestSeries) {
        return (
            <div className="max-w-2xl mx-auto px-4 py-24 text-center">
                <p className={isDarkMode ? 'text-gray-300' : 'text-gray-700'}>
                    Radarr/Sonarr ne sont pas encore configurés sur le serveur — cette fonctionnalité sera disponible une fois la configuration terminée.
                </p>
            </div>
        );
    }

    return (
        <div className="max-w-[1400px] mx-auto px-4 sm:px-6 lg:px-8 pt-8 pb-16 space-y-10">
            <div>
                <h1 className={`text-2xl font-bold mb-4 ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>Demander un film ou une série</h1>

                <div className="flex gap-2 mb-4">
                    {canRequestMovies && (
                        <button
                            onClick={() => setType('movie')}
                            className={`px-4 py-2 rounded-xl text-sm font-medium ${type === 'movie' ? 'bg-gradient-to-r from-red-600 to-orange-600 text-white' : isDarkMode ? 'bg-white/5 border border-white/10 text-gray-300' : 'bg-white border border-gray-200 text-gray-700'}`}
                        >
                            Films
                        </button>
                    )}
                    {canRequestSeries && (
                        <button
                            onClick={() => setType('series')}
                            className={`px-4 py-2 rounded-xl text-sm font-medium ${type === 'series' ? 'bg-gradient-to-r from-red-600 to-orange-600 text-white' : isDarkMode ? 'bg-white/5 border border-white/10 text-gray-300' : 'bg-white border border-gray-200 text-gray-700'}`}
                        >
                            Séries
                        </button>
                    )}
                </div>

                <div className={`flex items-center gap-3 px-4 py-3 rounded-2xl border max-w-xl ${isDarkMode ? 'bg-white/5 border-white/10' : 'bg-white border-gray-200'}`}>
                    <Search size={20} className={isDarkMode ? 'text-gray-400' : 'text-gray-500'} />
                    <input
                        value={query}
                        onChange={(event) => setQuery(event.target.value)}
                        placeholder="Rechercher sur TMDB..."
                        className={`flex-1 bg-transparent outline-none ${isDarkMode ? 'text-white placeholder-gray-500' : 'text-gray-900 placeholder-gray-400'}`}
                    />
                </div>

                {searching && <p className="mt-3 text-sm text-gray-400">Recherche...</p>}

                {results.length > 0 && (
                    <div className="mt-6 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
                        {results.map((result) => {
                            const already = isAlreadyRequested(result.tmdbId, type);
                            const isPending = pendingIds.has(result.tmdbId);
                            const isExpanded = expandedTmdbId === result.tmdbId;
                            return (
                                <div key={result.tmdbId} className="space-y-2">
                                    <div className="aspect-[2/3] rounded-lg overflow-hidden bg-white/5 border border-white/10">
                                        {result.posterUrl && <img src={result.posterUrl} alt={result.title} className="w-full h-full object-cover" />}
                                    </div>
                                    <p className={`text-sm font-medium line-clamp-1 ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>{result.title}</p>

                                    {!already && type === 'series' && isExpanded ? (
                                        <div className={`space-y-1.5 p-2 rounded-lg border text-xs ${isDarkMode ? 'bg-white/5 border-white/10' : 'bg-white border-gray-200'}`}>
                                            <button
                                                onClick={() => handleRequest(result, 'series')}
                                                disabled={isPending}
                                                className="w-full text-left px-2 py-1 rounded hover:bg-white/10"
                                            >
                                                Série entière
                                            </button>
                                            <div className="flex items-center gap-1">
                                                <input
                                                    type="number" min={1} value={scopeSeason}
                                                    onChange={(e) => setScopeSeason(Math.max(1, Number(e.target.value) || 1))}
                                                    className={`w-12 px-1.5 py-1 rounded border bg-transparent ${isDarkMode ? 'border-white/20 text-white' : 'border-gray-300 text-gray-900'}`}
                                                    aria-label="Numéro de saison"
                                                />
                                                <button
                                                    onClick={() => handleRequest(result, 'season', scopeSeason)}
                                                    disabled={isPending}
                                                    className="flex-1 text-left px-2 py-1 rounded hover:bg-white/10"
                                                >
                                                    Saison {scopeSeason}
                                                </button>
                                            </div>
                                            <div className="flex items-center gap-1">
                                                <input
                                                    type="number" min={1} value={scopeSeason}
                                                    onChange={(e) => setScopeSeason(Math.max(1, Number(e.target.value) || 1))}
                                                    className={`w-12 px-1.5 py-1 rounded border bg-transparent ${isDarkMode ? 'border-white/20 text-white' : 'border-gray-300 text-gray-900'}`}
                                                    aria-label="Numéro de saison"
                                                />
                                                <span className={isDarkMode ? 'text-gray-500' : 'text-gray-400'}>E</span>
                                                <input
                                                    type="number" min={1} value={scopeEpisode}
                                                    onChange={(e) => setScopeEpisode(Math.max(1, Number(e.target.value) || 1))}
                                                    className={`w-12 px-1.5 py-1 rounded border bg-transparent ${isDarkMode ? 'border-white/20 text-white' : 'border-gray-300 text-gray-900'}`}
                                                    aria-label="Numéro d'épisode"
                                                />
                                                <button
                                                    onClick={() => handleRequest(result, 'episode', scopeSeason, scopeEpisode)}
                                                    disabled={isPending}
                                                    className="flex-1 text-left px-1 py-1 rounded hover:bg-white/10"
                                                >
                                                    Épisode
                                                </button>
                                            </div>
                                            <button
                                                onClick={() => setExpandedTmdbId(null)}
                                                className={isDarkMode ? 'text-gray-400 hover:text-white' : 'text-gray-500 hover:text-gray-900'}
                                            >
                                                Annuler
                                            </button>
                                        </div>
                                    ) : (
                                        <button
                                            onClick={() => (type === 'series' ? setExpandedTmdbId(result.tmdbId) : handleRequest(result))}
                                            disabled={already || isPending}
                                            className={`w-full flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                                                already
                                                    ? 'bg-green-600/20 text-green-400 cursor-default'
                                                    : 'bg-white/10 hover:bg-white/20 border border-white/20'
                                            }`}
                                        >
                                            {already ? <><Check size={14} /> Demandé</> : <><Plus size={14} /> {isPending ? '...' : 'Demander'}</>}
                                        </button>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>

            {requests.length > 0 && (
                <div>
                    <h2 className={`text-xl font-bold mb-4 ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>Mes demandes</h2>
                    <div className="space-y-2">
                        {requests.map((request) => {
                            const Icon = STATUS_ICON[request.status];
                            return (
                                <div
                                    key={request.id}
                                    className={`flex items-center gap-4 p-3 rounded-xl border ${isDarkMode ? 'bg-white/5 border-white/10' : 'bg-white border-gray-200'}`}
                                >
                                    <div className="w-12 h-16 rounded overflow-hidden bg-white/5 shrink-0">
                                        {request.posterUrl && <img src={request.posterUrl} alt={request.title} className="w-full h-full object-cover" />}
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <p className={`font-medium truncate flex items-center gap-2 ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
                                            {request.title}
                                            {request.scope !== 'series' && request.seasonNumber && (
                                                <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold ${isDarkMode ? 'bg-white/10 text-gray-300' : 'bg-gray-100 text-gray-600'}`}>
                                                    <Tv size={10} />
                                                    S{request.seasonNumber}{request.episodeNumber ? `E${request.episodeNumber}` : ''}
                                                </span>
                                            )}
                                        </p>
                                        <p className={`text-xs ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>{request.year ?? ''}</p>
                                    </div>
                                    <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium ${
                                        request.status === 'available' ? 'bg-green-600/20 text-green-400'
                                        : request.status === 'failed' || request.status === 'rejected' ? 'bg-red-600/20 text-red-400'
                                        : 'bg-white/10 text-gray-300'
                                    }`}>
                                        <Icon size={12} /> {STATUS_LABEL[request.status]}
                                    </span>
                                    <button
                                        onClick={() => token && deleteRequest(token, request.id).then(loadRequests)}
                                        className="p-2 rounded-lg hover:bg-white/10 text-gray-400 hover:text-red-400"
                                        aria-label="Supprimer la demande"
                                    >
                                        <Trash2 size={16} />
                                    </button>
                                </div>
                            );
                        })}
                    </div>
                </div>
            )}
        </div>
    );
}
