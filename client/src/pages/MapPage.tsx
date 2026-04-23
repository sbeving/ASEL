import { useQuery } from '@tanstack/react-query';
import { MapContainer, TileLayer, Marker, Popup } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';
import { api } from '../lib/api';
import { PageHeader } from '../components/PageHeader';
import type { Franchise } from '../lib/types';

// Fix Leaflet's default icon issue in React
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon-2x.png',
  iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png',
});

export function MapPage() {
  const franchises = useQuery({
    queryKey: ['franchises'],
    queryFn: async () => (await api.get<{ franchises: Franchise[] }>('/franchises')).data.franchises,
  });

  const position: [number, number] = [33.5731, -7.5898]; // Default Casablanca

  return (
    <div className="h-full flex flex-col">
      <PageHeader title="Carte des Franchises" />
      <div className="flex-1 rounded-xl overflow-hidden border shadow-sm">
        <MapContainer center={position} zoom={6} scrollWheelZoom={true} className="h-full w-full">
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          {(franchises.data ?? []).map((f) => {
            if (!f.gps || !f.gps.lat || !f.gps.lng) return null;
            return (
              <Marker key={f._id} position={[f.gps.lat, f.gps.lng]}>
                <Popup>
                  <div className="font-semibold">{f.name}</div>
                  <div className="text-sm text-slate-500">{f.address}</div>
                  <div className="text-sm">{f.phone}</div>
                </Popup>
              </Marker>
            );
          })}
        </MapContainer>
      </div>
    </div>
  );
}
