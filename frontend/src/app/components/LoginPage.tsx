import { useState } from 'react';
import { motion } from 'motion/react';
import { User, Lock, Play, Eye, EyeOff } from 'lucide-react';

interface LoginPageProps {
  onLogin: (payload: { appEmail: string; appPassword: string }) => void;
  onRegister: (payload: { appEmail: string; appPassword: string }) => void;
  isLoading?: boolean;
  error?: string | null;
}

export function LoginPage({ onLogin, onRegister, isLoading = false, error = null }: LoginPageProps) {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [appEmail, setAppEmail] = useState('');
  const [appPassword, setAppPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [errors, setErrors] = useState<{ [key: string]: string }>({});

  const validateForm = () => {
    const newErrors: { [key: string]: string } = {};

    if (!appEmail.trim()) {
      newErrors.appEmail = 'L\'email de connexion est requis';
    }

    if (!appPassword) {
      newErrors.appPassword = 'Le mot de passe de connexion est requis';
    } else if (appPassword.length < 8) {
      newErrors.appPassword = 'Le mot de passe doit contenir au moins 8 caractères';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    if (validateForm()) {
      if (mode === 'register') {
        onRegister({ appEmail, appPassword });
      } else {
        onLogin({ appEmail, appPassword });
      }
    }
  };

  return (
    <div className="min-h-screen bg-black text-white flex items-center justify-center p-4 overflow-hidden">
      {/* Animated Background */}
      <div className="fixed inset-0 overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-red-900/30 via-black to-orange-900/30" />

        {/* Animated Orbs */}
        <motion.div
          className="absolute top-1/4 left-1/4 w-96 h-96 bg-red-600/20 rounded-full blur-3xl"
          animate={{
            scale: [1, 1.2, 1],
            opacity: [0.3, 0.5, 0.3],
          }}
          transition={{
            duration: 8,
            repeat: Infinity,
            ease: 'easeInOut',
          }}
        />
        <motion.div
          className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-orange-600/20 rounded-full blur-3xl"
          animate={{
            scale: [1.2, 1, 1.2],
            opacity: [0.5, 0.3, 0.5],
          }}
          transition={{
            duration: 8,
            repeat: Infinity,
            ease: 'easeInOut',
          }}
        />
      </div>

      {/* Login Card */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6 }}
        className="relative w-full max-w-md"
      >
        {/* Logo and Title */}
        <div className="text-center mb-8">
          <motion.div
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={{ delay: 0.2, type: 'spring', stiffness: 200 }}
            className="inline-block mb-6"
          >
            <div className="relative">
              <div className="absolute inset-0 bg-gradient-to-r from-red-600 to-orange-600 rounded-2xl blur-2xl opacity-50" />
              <div className="relative w-20 h-20 bg-gradient-to-br from-red-600 to-orange-600 rounded-2xl flex items-center justify-center">
                <Play size={40} fill="white" className="text-white ml-1" />
              </div>
            </div>
          </motion.div>

          <motion.h1
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.3 }}
            className="text-4xl font-bold mb-2 bg-gradient-to-r from-red-500 to-orange-500 bg-clip-text text-transparent"
          >
            StreamHub
          </motion.h1>

          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.4 }}
            className="text-gray-400"
          >
            Connectez-vous à votre compte local
          </motion.p>
        </div>

        {/* Login Form */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.5 }}
          className="relative bg-white/5 backdrop-blur-xl border border-white/10 rounded-2xl p-8 shadow-2xl"
        >
          <div className="mb-6 grid grid-cols-2 gap-2 p-1 rounded-xl bg-white/5 border border-white/10">
            <button
              type="button"
              onClick={() => setMode('login')}
              className={`py-2 rounded-lg text-sm font-medium transition-colors ${mode === 'login' ? 'bg-gradient-to-r from-red-600 to-orange-600 text-white' : 'text-gray-300 hover:bg-white/5'
                }`}
            >
              Se connecter
            </button>
            <button
              type="button"
              onClick={() => setMode('register')}
              className={`py-2 rounded-lg text-sm font-medium transition-colors ${mode === 'register' ? 'bg-gradient-to-r from-red-600 to-orange-600 text-white' : 'text-gray-300 hover:bg-white/5'
                }`}
            >
              Créer un compte
            </button>
          </div>

          <form onSubmit={handleSubmit} className="space-y-6">
            <div>
              <label className="block text-sm font-medium mb-2 text-gray-300">
                Email de connexion
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                  <User size={20} className="text-gray-400" />
                </div>
                <input
                  type="email"
                  value={appEmail}
                  onChange={(e) => setAppEmail(e.target.value)}
                  placeholder="vous@exemple.com"
                  className={`w-full pl-12 pr-4 py-3 bg-white/5 border ${errors.appEmail ? 'border-red-500/50' : 'border-white/10'
                    } rounded-xl text-white placeholder-gray-500 focus:outline-none focus:border-red-500/50 focus:ring-2 focus:ring-red-500/20 transition-all`}
                />
              </div>
              {errors.appEmail && (
                <motion.p
                  initial={{ opacity: 0, y: -10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="text-red-400 text-sm mt-2"
                >
                  {errors.appEmail}
                </motion.p>
              )}
            </div>

            <div>
              <label className="block text-sm font-medium mb-2 text-gray-300">
                Mot de passe de connexion
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                  <Lock size={20} className="text-gray-400" />
                </div>
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={appPassword}
                  onChange={(e) => setAppPassword(e.target.value)}
                  placeholder="Mot de passe application"
                  className={`w-full pl-12 pr-4 py-3 bg-white/5 border ${errors.appPassword ? 'border-red-500/50' : 'border-white/10'
                    } rounded-xl text-white placeholder-gray-500 focus:outline-none focus:border-red-500/50 focus:ring-2 focus:ring-red-500/20 transition-all`}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute inset-y-0 right-0 pr-4 flex items-center text-gray-400 hover:text-white transition-colors"
                >
                  {showPassword ? <EyeOff size={20} /> : <Eye size={20} />}
                </button>
              </div>
              {errors.appPassword && (
                <motion.p
                  initial={{ opacity: 0, y: -10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="text-red-400 text-sm mt-2"
                >
                  {errors.appPassword}
                </motion.p>
              )}
            </div>

            {/* Submit Button */}
            <motion.button
              type="submit"
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              disabled={isLoading}
              className="w-full py-3 bg-gradient-to-r from-red-600 to-orange-600 rounded-xl font-semibold text-white shadow-lg hover:shadow-red-500/50 transition-all duration-300"
            >
              {isLoading ? 'Chargement...' : mode === 'register' ? 'Créer un compte' : 'Se connecter'}
            </motion.button>

            {error && <p className="text-red-400 text-sm text-center">{error}</p>}
          </form>

          {/* Additional Info */}
          <div className="mt-6 pt-6 border-t border-white/10">
            <p className="text-center text-sm text-gray-400">
              Les identifiants IPTV seront demandés après connexion
            </p>
          </div>
        </motion.div>

        {/* Footer */}
        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.8 }}
          className="text-center text-sm text-gray-500 mt-8"
        >
          © 2026 StreamHub - Plateforme de streaming personnelle
        </motion.p>
      </motion.div>
    </div>
  );
}
