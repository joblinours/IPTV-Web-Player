import { useState } from 'react';
import { motion } from 'motion/react';
import { Server, User, Lock, Plus } from 'lucide-react';

interface IptvCredentialsDialogProps {
    open: boolean;
    isLoading?: boolean;
    error?: string | null;
    onClose?: () => void;
    onSubmit: (payload: {
        name: string;
        serverUrl: string;
        username: string;
        password: string;
    }) => void;
}

export function IptvCredentialsDialog({ open, isLoading = false, error = null, onClose, onSubmit }: IptvCredentialsDialogProps) {
    const [name, setName] = useState('Compte principal');
    const [serverUrl, setServerUrl] = useState('');
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [errors, setErrors] = useState<Record<string, string>>({});

    if (!open) return null;

    const validate = () => {
        const nextErrors: Record<string, string> = {};

        if (!name.trim()) nextErrors.name = 'Le nom du compte est requis';
        if (!serverUrl.trim()) {
            nextErrors.serverUrl = 'L\'URL du serveur est requise';
        } else if (!serverUrl.startsWith('http://') && !serverUrl.startsWith('https://')) {
            nextErrors.serverUrl = 'L\'URL doit commencer par http:// ou https://';
        }
        if (!username.trim()) nextErrors.username = 'Le nom utilisateur IPTV est requis';
        if (!password.trim()) nextErrors.password = 'Le mot de passe IPTV est requis';

        setErrors(nextErrors);
        return Object.keys(nextErrors).length === 0;
    };

    const handleSubmit = (event: React.FormEvent) => {
        event.preventDefault();
        if (!validate()) return;

        onSubmit({
            name: name.trim(),
            serverUrl: serverUrl.trim(),
            username: username.trim(),
            password,
        });
    };

    return (
        <div className="fixed inset-0 z-[120] bg-black/80 backdrop-blur-sm p-4 flex items-center justify-center">
            <motion.div
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                className="w-full max-w-lg rounded-2xl border border-white/10 bg-black p-6 shadow-2xl"
            >
                <div className="mb-5">
                    <div className="flex items-center justify-between gap-3">
                        <h2 className="text-xl font-semibold text-white">Configurer un compte IPTV</h2>
                        {onClose && (
                            <button onClick={onClose} className="px-2.5 py-1 rounded-lg bg-white/10 hover:bg-white/20 text-sm">
                                Fermer
                            </button>
                        )}
                    </div>
                    <p className="text-sm text-gray-400 mt-1">Ajoute tes identifiants IPTV pour charger les catalogues.</p>
                </div>

                <form onSubmit={handleSubmit} className="space-y-4">
                    <div>
                        <label className="block text-sm text-gray-300 mb-2">Nom du compte</label>
                        <div className="relative">
                            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                                <Plus size={18} className="text-gray-400" />
                            </div>
                            <input
                                value={name}
                                onChange={(event) => setName(event.target.value)}
                                className={`w-full pl-10 pr-3 py-2.5 rounded-xl bg-white/5 border ${errors.name ? 'border-red-500/60' : 'border-white/10'} text-white`}
                                placeholder="Compte principal"
                            />
                        </div>
                        {errors.name && <p className="text-red-400 text-sm mt-1">{errors.name}</p>}
                    </div>

                    <div>
                        <label className="block text-sm text-gray-300 mb-2">URL serveur</label>
                        <div className="relative">
                            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                                <Server size={18} className="text-gray-400" />
                            </div>
                            <input
                                value={serverUrl}
                                onChange={(event) => setServerUrl(event.target.value)}
                                className={`w-full pl-10 pr-3 py-2.5 rounded-xl bg-white/5 border ${errors.serverUrl ? 'border-red-500/60' : 'border-white/10'} text-white`}
                                placeholder="https://serveur.exemple.com"
                            />
                        </div>
                        {errors.serverUrl && <p className="text-red-400 text-sm mt-1">{errors.serverUrl}</p>}
                    </div>

                    <div>
                        <label className="block text-sm text-gray-300 mb-2">Identifiant IPTV</label>
                        <div className="relative">
                            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                                <User size={18} className="text-gray-400" />
                            </div>
                            <input
                                value={username}
                                onChange={(event) => setUsername(event.target.value)}
                                className={`w-full pl-10 pr-3 py-2.5 rounded-xl bg-white/5 border ${errors.username ? 'border-red-500/60' : 'border-white/10'} text-white`}
                                placeholder="username"
                            />
                        </div>
                        {errors.username && <p className="text-red-400 text-sm mt-1">{errors.username}</p>}
                    </div>

                    <div>
                        <label className="block text-sm text-gray-300 mb-2">Mot de passe IPTV</label>
                        <div className="relative">
                            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                                <Lock size={18} className="text-gray-400" />
                            </div>
                            <input
                                type="password"
                                value={password}
                                onChange={(event) => setPassword(event.target.value)}
                                className={`w-full pl-10 pr-3 py-2.5 rounded-xl bg-white/5 border ${errors.password ? 'border-red-500/60' : 'border-white/10'} text-white`}
                                placeholder="password"
                            />
                        </div>
                        {errors.password && <p className="text-red-400 text-sm mt-1">{errors.password}</p>}
                    </div>

                    {error && <p className="text-red-400 text-sm">{error}</p>}

                    <button
                        type="submit"
                        disabled={isLoading}
                        className="w-full py-2.5 rounded-xl bg-gradient-to-r from-red-600 to-orange-600 text-white font-semibold"
                    >
                        {isLoading ? 'Enregistrement...' : 'Ajouter le compte IPTV'}
                    </button>
                </form>
            </motion.div>
        </div>
    );
}
