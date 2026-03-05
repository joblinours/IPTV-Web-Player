import { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Search, Settings, LogOut, X, Menu, Sun, Moon } from 'lucide-react';
import { SettingsDialog } from './SettingsDialog';
import type { IptvAccount } from '../lib/api';

interface HeaderProps {
  activeSection: 'live' | 'films' | 'series';
  onSectionChange: (section: 'live' | 'films' | 'series') => void;
  searchQuery: string;
  onSearchChange: (query: string) => void;
  onLogout: () => void;
  isDarkMode: boolean;
  onToggleDarkMode: () => void;
  accounts?: IptvAccount[];
  activeAccountId?: number | null;
  onSwitchAccount?: (accountId: number) => void;
  onAddAccount?: () => void;
}

export function Header({
  activeSection,
  onSectionChange,
  searchQuery,
  onSearchChange,
  onLogout,
  isDarkMode,
  onToggleDarkMode,
  accounts,
  activeAccountId,
  onSwitchAccount,
  onAddAccount,
}: HeaderProps) {
  const [searchOpen, setSearchOpen] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const handleLogout = () => {
    if (confirm('Êtes-vous sûr de vouloir vous déconnecter ?')) {
      onLogout();
    }
  };

  return (
    <>
      <header className="fixed top-0 left-0 right-0 z-50 transition-all duration-300">
        <div className={`absolute inset-0 backdrop-blur-xl border-b transition-colors duration-300 ${isDarkMode
            ? 'bg-black/60 border-white/10'
            : 'bg-white/60 border-gray-200'
          }`} />

        <div className="relative max-w-[1920px] mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-20">
            {/* Logo */}
            <motion.div
              className="flex items-center gap-3 cursor-pointer"
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
            >
              <div className="relative">
                <div className="absolute inset-0 bg-gradient-to-r from-red-600 to-orange-600 rounded-xl blur-lg opacity-50" />
                <div className="relative w-12 h-12 bg-gradient-to-br from-red-600 to-orange-600 rounded-xl flex items-center justify-center">
                  <svg
                    width="28"
                    height="28"
                    viewBox="0 0 24 24"
                    fill="none"
                    xmlns="http://www.w3.org/2000/svg"
                  >
                    <path d="M5 3L19 12L5 21V3Z" fill="white" />
                  </svg>
                </div>
              </div>
              <div className="hidden sm:block">
                <span className={`text-2xl font-bold bg-gradient-to-r from-red-500 to-orange-500 bg-clip-text text-transparent`}>
                  StreamHub
                </span>
              </div>
            </motion.div>

            {/* Navigation Desktop */}
            <nav className="hidden md:flex items-center gap-2">
              {(['live', 'films', 'series'] as const).map((section) => (
                <motion.button
                  key={section}
                  onClick={() => onSectionChange(section)}
                  className={`relative px-6 py-2.5 rounded-xl transition-all duration-300 ${activeSection === section
                      ? isDarkMode ? 'text-white' : 'text-gray-900'
                      : isDarkMode ? 'text-gray-400 hover:text-white' : 'text-gray-600 hover:text-gray-900'
                    }`}
                  whileHover={{ scale: 1.05 }}
                  whileTap={{ scale: 0.95 }}
                >
                  {activeSection === section && (
                    <motion.div
                      layoutId="activeTab"
                      className={`absolute inset-0 backdrop-blur-sm rounded-xl border transition-colors duration-300 ${isDarkMode
                          ? 'bg-gradient-to-r from-red-600/30 to-orange-600/30 border-white/10'
                          : 'bg-gradient-to-r from-red-100 to-orange-100 border-red-200'
                        }`}
                      transition={{ type: 'spring', bounce: 0.2, duration: 0.6 }}
                    />
                  )}
                  <span className="relative z-10 font-medium capitalize">
                    {section === 'live' ? 'Live' : section === 'films' ? 'Films' : 'Séries'}
                  </span>
                </motion.button>
              ))}
            </nav>

            {/* Actions */}
            <div className="flex items-center gap-2">
              {/* Search */}
              <AnimatePresence>
                {searchOpen && (
                  <motion.div
                    initial={{ width: 0, opacity: 0 }}
                    animate={{ width: 'auto', opacity: 1 }}
                    exit={{ width: 0, opacity: 0 }}
                    transition={{ duration: 0.2 }}
                    className="overflow-hidden"
                  >
                    <input
                      type="text"
                      value={searchQuery}
                      onChange={(e) => onSearchChange(e.target.value)}
                      placeholder="Rechercher..."
                      className={`w-64 px-4 py-2.5 backdrop-blur-xl border rounded-xl focus:outline-none focus:ring-2 transition-colors duration-300 ${isDarkMode
                          ? 'bg-white/10 border-white/20 text-white placeholder-gray-400 focus:border-red-500/50 focus:ring-red-500/20'
                          : 'bg-gray-100 border-gray-300 text-gray-900 placeholder-gray-500 focus:border-red-500 focus:ring-red-500/20'
                        }`}
                      autoFocus
                    />
                  </motion.div>
                )}
              </AnimatePresence>

              <motion.button
                onClick={() => setSearchOpen(!searchOpen)}
                className={`p-2.5 rounded-xl transition-colors relative group ${isDarkMode ? 'hover:bg-white/10' : 'hover:bg-gray-200'
                  }`}
                whileHover={{ scale: 1.1 }}
                whileTap={{ scale: 0.9 }}
              >
                <div className={`absolute inset-0 rounded-xl opacity-0 group-hover:opacity-100 transition-opacity ${isDarkMode ? 'bg-gradient-to-r from-red-600/20 to-orange-600/20' : 'bg-gradient-to-r from-red-100 to-orange-100'
                  }`} />
                <span className="relative z-10">{searchOpen ? <X size={20} /> : <Search size={20} />}</span>
              </motion.button>

              <motion.button
                onClick={onToggleDarkMode}
                className={`hidden sm:block p-2.5 rounded-xl transition-colors relative group ${isDarkMode ? 'hover:bg-white/10' : 'hover:bg-gray-200'
                  }`}
                whileHover={{ scale: 1.1 }}
                whileTap={{ scale: 0.9 }}
              >
                <div className={`absolute inset-0 rounded-xl opacity-0 group-hover:opacity-100 transition-opacity ${isDarkMode ? 'bg-gradient-to-r from-red-600/20 to-orange-600/20' : 'bg-gradient-to-r from-red-100 to-orange-100'
                  }`} />
                <span className="relative z-10">{isDarkMode ? <Sun size={20} /> : <Moon size={20} />}</span>
              </motion.button>

              <motion.button
                onClick={() => setSettingsOpen(true)}
                className={`hidden sm:block p-2.5 rounded-xl transition-colors relative group ${isDarkMode ? 'hover:bg-white/10' : 'hover:bg-gray-200'
                  }`}
                whileHover={{ scale: 1.1 }}
                whileTap={{ scale: 0.9 }}
              >
                <div className={`absolute inset-0 rounded-xl opacity-0 group-hover:opacity-100 transition-opacity ${isDarkMode ? 'bg-gradient-to-r from-red-600/20 to-orange-600/20' : 'bg-gradient-to-r from-red-100 to-orange-100'
                  }`} />
                <span className="relative z-10"><Settings size={20} /></span>
              </motion.button>

              <motion.button
                onClick={handleLogout}
                className={`hidden sm:block p-2.5 rounded-xl transition-colors relative group ${isDarkMode ? 'hover:bg-white/10' : 'hover:bg-gray-200'
                  }`}
                whileHover={{ scale: 1.1 }}
                whileTap={{ scale: 0.9 }}
              >
                <div className={`absolute inset-0 rounded-xl opacity-0 group-hover:opacity-100 transition-opacity ${isDarkMode ? 'bg-gradient-to-r from-red-600/20 to-orange-600/20' : 'bg-gradient-to-r from-red-100 to-orange-100'
                  }`} />
                <span className="relative z-10"><LogOut size={20} /></span>
              </motion.button>

              {/* Mobile Menu Button */}
              <motion.button
                onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
                className={`md:hidden p-2.5 rounded-xl transition-colors ${isDarkMode ? 'hover:bg-white/10' : 'hover:bg-gray-200'
                  }`}
                whileHover={{ scale: 1.1 }}
                whileTap={{ scale: 0.9 }}
              >
                <Menu size={20} />
              </motion.button>
            </div>
          </div>

          {/* Mobile Menu */}
          <AnimatePresence>
            {mobileMenuOpen && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                className="md:hidden overflow-hidden"
              >
                <div className="py-4 space-y-2">
                  {(['live', 'films', 'series'] as const).map((section) => (
                    <button
                      key={section}
                      onClick={() => {
                        onSectionChange(section);
                        setMobileMenuOpen(false);
                      }}
                      className={`w-full text-left px-4 py-3 rounded-xl transition-colors ${activeSection === section
                          ? isDarkMode
                            ? 'bg-gradient-to-r from-red-600/30 to-orange-600/30 text-white'
                            : 'bg-gradient-to-r from-red-100 to-orange-100 text-gray-900'
                          : isDarkMode
                            ? 'text-gray-400 hover:bg-white/5'
                            : 'text-gray-600 hover:bg-gray-100'
                        }`}
                    >
                      {section === 'live' ? 'Live' : section === 'films' ? 'Films' : 'Séries'}
                    </button>
                  ))}
                  <div className={`pt-2 border-t space-y-2 ${isDarkMode ? 'border-white/10' : 'border-gray-200'}`}>
                    <button
                      onClick={onToggleDarkMode}
                      className={`w-full text-left px-4 py-3 rounded-xl transition-colors ${isDarkMode ? 'text-gray-400 hover:bg-white/5' : 'text-gray-600 hover:bg-gray-100'
                        }`}
                    >
                      {isDarkMode ? 'Mode clair' : 'Mode sombre'}
                    </button>
                    <button
                      onClick={() => {
                        setSettingsOpen(true);
                        setMobileMenuOpen(false);
                      }}
                      className={`w-full text-left px-4 py-3 rounded-xl transition-colors ${isDarkMode ? 'text-gray-400 hover:bg-white/5' : 'text-gray-600 hover:bg-gray-100'
                        }`}
                    >
                      Paramètres
                    </button>
                    <button
                      onClick={handleLogout}
                      className={`w-full text-left px-4 py-3 rounded-xl transition-colors ${isDarkMode ? 'text-gray-400 hover:bg-white/5' : 'text-gray-600 hover:bg-gray-100'
                        }`}
                    >
                      Déconnexion
                    </button>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </header>

      {/* Settings Dialog */}
      <SettingsDialog
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        accounts={accounts}
        activeAccountId={activeAccountId}
        onSwitchAccount={onSwitchAccount}
        onAddAccount={onAddAccount}
      />
    </>
  );
}
