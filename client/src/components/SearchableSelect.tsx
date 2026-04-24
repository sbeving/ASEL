import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import clsx from 'clsx';

export interface SearchableSelectOption {
  value: string;
  label: string;
  subtitle?: string;
  keywords?: string;
  disabled?: boolean;
}

interface SearchableSelectProps {
  value: string;
  options: SearchableSelectOption[];
  onChange: (nextValue: string) => void;
  placeholder?: string;
  emptyMessage?: string;
  disabled?: boolean;
  className?: string;
  maxResults?: number;
  allowClear?: boolean;
}

function normalize(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
}

export function SearchableSelect({
  value,
  options,
  onChange,
  placeholder = 'Search...',
  emptyMessage = 'No result',
  disabled = false,
  className,
  maxResults = 80,
  allowClear = false,
}: SearchableSelectProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const selected = useMemo(
    () => options.find((option) => option.value === value) ?? null,
    [options, value],
  );
  const [query, setQuery] = useState(selected?.label ?? '');
  const [open, setOpen] = useState(false);
  const [keyboardIndex, setKeyboardIndex] = useState(-1);

  useEffect(() => {
    setQuery(selected?.label ?? '');
  }, [selected?.label]);

  useEffect(() => {
    const handler = (event: MouseEvent) => {
      const target = event.target as Node;
      if (rootRef.current && !rootRef.current.contains(target)) {
        setOpen(false);
        setKeyboardIndex(-1);
        setQuery(selected?.label ?? '');
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [selected?.label]);

  const filtered = useMemo(() => {
    const needle = normalize(query);
    const source = needle
      ? options.filter((option) => {
          const hay = `${option.label} ${option.keywords ?? ''}`;
          return normalize(hay).includes(needle);
        })
      : options;
    return source.slice(0, maxResults);
  }, [maxResults, options, query]);

  const commitSelection = (option: SearchableSelectOption) => {
    if (option.disabled) return;
    onChange(option.value);
    setQuery(option.label);
    setOpen(false);
    setKeyboardIndex(-1);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (!open && (event.key === 'ArrowDown' || event.key === 'Enter')) {
      setOpen(true);
      return;
    }
    if (!open) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setKeyboardIndex((current) => Math.min(filtered.length - 1, current + 1));
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      setKeyboardIndex((current) => Math.max(0, current - 1));
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      const picked = filtered[keyboardIndex] ?? filtered[0];
      if (picked) commitSelection(picked);
      return;
    }
    if (event.key === 'Escape') {
      setOpen(false);
      setKeyboardIndex(-1);
      setQuery(selected?.label ?? '');
    }
  };

  return (
    <div ref={rootRef} className={clsx('relative', className)}>
      <input
        className="input pr-9"
        disabled={disabled}
        placeholder={placeholder}
        value={query}
        onFocus={() => {
          if (!disabled) setOpen(true);
        }}
        onChange={(event) => {
          setQuery(event.target.value);
          setOpen(true);
          setKeyboardIndex(-1);
          if (selected && event.target.value.trim() === '') onChange('');
        }}
        onKeyDown={onKeyDown}
      />
      {allowClear && value && !disabled && (
        <button
          type="button"
          className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-xs text-slate-400 hover:bg-slate-100 hover:text-slate-600"
          onClick={() => {
            onChange('');
            setQuery('');
            setOpen(false);
          }}
        >
          clear
        </button>
      )}
      {open && !disabled && (
        <div className="absolute z-30 mt-1 max-h-64 w-full overflow-auto rounded-lg border border-slate-200 bg-white py-1 shadow-lg">
          {filtered.length > 0 ? (
            filtered.map((option, index) => (
              <button
                key={option.value}
                type="button"
                disabled={option.disabled}
                onClick={() => commitSelection(option)}
                className={clsx(
                  'flex w-full flex-col items-start px-3 py-2 text-left text-sm',
                  option.disabled
                    ? 'cursor-not-allowed text-slate-300'
                    : 'hover:bg-slate-50',
                  option.value === value ? 'bg-brand-50 text-brand-700' : 'text-slate-700',
                  keyboardIndex === index ? 'bg-slate-100' : '',
                )}
              >
                <span className="font-medium">{option.label}</span>
                {option.subtitle && <span className="text-xs text-slate-500">{option.subtitle}</span>}
              </button>
            ))
          ) : (
            <div className="px-3 py-2 text-sm text-slate-400">{emptyMessage}</div>
          )}
        </div>
      )}
    </div>
  );
}
