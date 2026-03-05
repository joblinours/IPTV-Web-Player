import { useState } from 'react';
import { motion } from 'motion/react';
import { Shield, Volume2, Globe } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from './ui/dialog';
import type { IptvAccount } from '../lib/api';

interface SettingsDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    accounts?: IptvAccount[];
    activeAccountId?: number | null;
    onSwitchAccount?: (accountId: number) => void;
    onAddAccount?: () => void;
}

export function SettingsDialog({ open, onOpenChange, accounts = [], activeAccountId = null, onSwitchAccount, onAddAccount }: SettingsDialogProps) {
    const [language, setLanguage] = useState('fr');
    const [autoplay, setAutoplay] = useState(true);

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="bg-gray-900/95 backdrop-blur-xl border border-white/10 text-white max-w-2xl max-h-[85vh] overflow-y-auto">
                <DialogHeader>
                    <DialogTitle className="text-2xl font-bold bg-gradient-to-r from-red-500 to-orange-500 bg-clip-text text-transparent">
                        Paramètres
                    </DialogTitle>
                    <DialogDescription className="text-gray-400">
                        Réglages essentiels de l'application
                    </DialogDescription>
                </DialogHeader>

                <div className="space-y-6 mt-6">
                    <div className="space-y-3">
                        <div className="flex items-center gap-3">
                            <div className="p-2 bg-blue-600/20 rounded-lg">
                                <Globe size={20} className="text-blue-400" />
                            </div>
                            <div>
                                <h3 className="font-semibold">Compte IPTV actif</h3>
                                <p className="text-sm text-gray-400">Sélectionnez le compte utilisé pour le catalogue</p>
                            </div>
                        </div>

                        <div className="space-y-2">
                            {accounts.length === 0 && <p className="text-sm text-gray-400">Aucun compte IPTV configuré.</p>}
                            {accounts.map((account) => (
                                <button
                                    key={account.id}
                                    onClick={() => onSwitchAccount?.(account.id)}
                                    className={`w-full text-left px-4 py-3 rounded-xl border transition-colors ${activeAccountId === account.id
                                            ? 'bg-gradient-to-r from-red-600/40 to-orange-600/40 border-red-500/40'
                                            : 'bg-white/5 border-white/10 hover:bg-white/10'
                                        }`}
                                >
                                    <p className="font-medium">{account.name}</p>
                                    <p className="text-xs text-gray-400">{account.server_url} • {account.username}</p>
                                </button>
                            ))}

                            <button
                                onClick={onAddAccount}
                                className="w-full px-4 py-2.5 rounded-xl bg-white/10 border border-white/20 hover:bg-white/20"
                            >
                                Ajouter un compte IPTV
                            </button>
                        </div>
                    </div>

                    <div className="space-y-3">
                        <div className="flex items-center gap-3">
                            <div className="p-2 bg-orange-600/20 rounded-lg">
                                <Globe size={20} className="text-orange-400" />
                            </div>
                            <div>
                                <h3 className="font-semibold">Langue</h3>
                                <p className="text-sm text-gray-400">Langue de l'interface</p>
                            </div>
                        </div>
                        <select
                            value={language}
                            onChange={(e) => setLanguage(e.target.value)}
                            className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white focus:outline-none focus:border-red-500/50 focus:ring-2 focus:ring-red-500/20"
                        >
                            <option value="fr">Français</option>
                            <option value="en">English</option>
                            <option value="es">Español</option>
                            <option value="de">Deutsch</option>
                        </select>
                    </div>

                    <div className="space-y-3">
                        <div className="flex items-center gap-3">
                            <div className="p-2 bg-orange-600/20 rounded-lg">
                                <Volume2 size={20} className="text-orange-400" />
                            </div>
                            <div className="flex-1">
                                <h3 className="font-semibold">Lecture automatique</h3>
                                <p className="text-sm text-gray-400">Lire automatiquement l'épisode suivant</p>
                            </div>
                            <label className="relative inline-flex items-center cursor-pointer">
                                <input
                                    type="checkbox"
                                    checked={autoplay}
                                    onChange={(e) => setAutoplay(e.target.checked)}
                                    className="sr-only peer"
                                />
                                <div className="w-14 h-7 bg-white/10 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-red-500/20 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-0.5 after:start-[4px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-6 after:w-6 after:transition-all peer-checked:bg-gradient-to-r peer-checked:from-red-600 peer-checked:to-orange-600"></div>
                            </label>
                        </div>
                    </div>

                    <div className="space-y-3">
                        <div className="flex items-center gap-3">
                            <div className="p-2 bg-red-600/20 rounded-lg">
                                <Shield size={20} className="text-red-400" />
                            </div>
                            <div>
                                <h3 className="font-semibold">Confidentialité</h3>
                                <p className="text-sm text-gray-400">Gérez vos données locales</p>
                            </div>
                        </div>
                        <div className="space-y-2">
                            <button className="w-full px-4 py-2 bg-white/5 border border-white/10 rounded-lg hover:bg-white/10 transition-colors text-left">
                                Effacer l'historique de visionnage
                            </button>
                            <button className="w-full px-4 py-2 bg-white/5 border border-white/10 rounded-lg hover:bg-white/10 transition-colors text-left">
                                Gérer les données de cache
                            </button>
                        </div>
                    </div>

                    <div className="flex gap-3 pt-4 border-t border-white/10">
                        <motion.button
                            onClick={() => onOpenChange(false)}
                            whileHover={{ scale: 1.02 }}
                            whileTap={{ scale: 0.98 }}
                            className="flex-1 px-6 py-3 bg-white/5 border border-white/10 rounded-xl font-semibold hover:bg-white/10 transition-colors"
                        >
                            Fermer
                        </motion.button>
                        <motion.button
                            onClick={() => onOpenChange(false)}
                            whileHover={{ scale: 1.02 }}
                            whileTap={{ scale: 0.98 }}
                            className="flex-1 px-6 py-3 bg-gradient-to-r from-red-600 to-orange-600 rounded-xl font-semibold hover:shadow-lg hover:shadow-red-500/50 transition-all"
                        >
                            Sauvegarder
                        </motion.button>
                    </div>
                </div>
            </DialogContent>
        </Dialog>
    );
}
