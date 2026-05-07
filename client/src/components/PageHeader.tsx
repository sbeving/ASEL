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
      className="mb-5 flex flex-col items-start justify-between gap-3 sm:mb-6 sm:flex-row sm:items-end"
    >
      <div className="min-w-0">
        <h1 className="text-xl font-bold tracking-tight text-surface-900 dark:text-white sm:text-2xl lg:text-3xl">
          {title}
        </h1>
        {subtitle && (
          <p className="mt-1.5 max-w-3xl text-sm font-medium leading-6 text-surface-500 dark:text-surface-400">
            {subtitle}
          </p>
        )}
      </div>
      {actions && (
        <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center sm:justify-end [&>a]:w-full [&>button]:w-full sm:[&>a]:w-auto sm:[&>button]:w-auto">
          {actions}
        </div>
      )}
    </motion.div>
  );
}
