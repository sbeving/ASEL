import { Layers } from 'lucide-react';
import { TileLayer } from 'react-leaflet';

export type MapTileMode = 'street' | 'satellite';

const tileModes: Record<MapTileMode, { label: string; attribution: string; url: string }> = {
  street: {
    label: 'Plan',
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
  },
  satellite: {
    label: 'Satellite',
    attribution:
      'Tiles &copy; Esri, Maxar, Earthstar Geographics, and the GIS User Community',
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
  },
};

export function MapTiles({ mode }: { mode: MapTileMode }) {
  const tile = tileModes[mode];
  return <TileLayer attribution={tile.attribution} url={tile.url} />;
}

export function MapTileToggle({
  value,
  onChange,
  className = '',
}: {
  value: MapTileMode;
  onChange: (value: MapTileMode) => void;
  className?: string;
}) {
  return (
    <div
      className={`z-[500] inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white/95 p-1 text-xs font-semibold text-slate-700 shadow-soft ${className}`}
      aria-label="Fond de carte"
    >
      <Layers className="ml-1 h-4 w-4 text-slate-400" />
      {(Object.keys(tileModes) as MapTileMode[]).map((mode) => (
        <button
          key={mode}
          type="button"
          className={`rounded-md px-2.5 py-1.5 transition-colors ${
            value === mode
              ? 'bg-slate-900 text-white'
              : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
          }`}
          onClick={() => onChange(mode)}
        >
          {tileModes[mode].label}
        </button>
      ))}
    </div>
  );
}
