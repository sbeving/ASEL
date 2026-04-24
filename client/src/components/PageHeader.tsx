import type { ReactNode } from 'react';
import { motion } from 'framer-motion';

export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
}) {
  return (
    <motion.div 
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className="mb-6 flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-end"
    >
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-surface-900 dark:text-white sm:text-3xl">
          {title}
        </h1>
        {subtitle && (
          <p className="mt-1.5 text-sm font-medium text-surface-500 dark:text-surface-400">
            {subtitle}
          </p>
        )}
      </div>
      {actions && (
        <div className="flex w-full sm:w-auto items-center gap-3">
          {actions}
        </div>
      )}
    </motion.div>
  );
}
