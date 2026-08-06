import { motion } from 'motion/react';

interface AppFooterProps {
    isDarkMode?: boolean;
}

/**
 * Small, persistent version indicator shown at the bottom of every screen
 * (main app shell and login page). __APP_VERSION__/__GIT_COMMIT__ are
 * injected at build time — see vite.config.ts.
 */
export function AppFooter({ isDarkMode = true }: AppFooterProps) {
    const shortCommit = __GIT_COMMIT__.slice(0, 7);

    return (
        <motion.footer
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.4 }}
            className={`relative py-6 text-center text-xs ${isDarkMode ? 'text-gray-600' : 'text-gray-400'}`}
        >
            StreamHub v{__APP_VERSION__} <span className="opacity-60">({shortCommit})</span>
        </motion.footer>
    );
}
