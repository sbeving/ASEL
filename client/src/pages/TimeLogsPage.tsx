import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, apiError } from '../lib/api';
import { dateTime } from '../lib/money';
import { PageHeader } from '../components/PageHeader';

type TimeLogType = 'entree' | 'sortie' | 'pause_debut' | 'pause_fin';

interface TimeLog {
  _id: string;
  type: TimeLogType;
  timestamp: string;
  gps?: { lat?: number; lng?: number; address?: string };
  note?: string;
  device?: string;
}

const labels: Record<TimeLogType, string> = {
  entree: 'Entree',
  sortie: 'Sortie',
  pause_debut: 'Pause debut',
  pause_fin: 'Pause fin',
};

const badgeByType: Record<TimeLogType, string> = {
  entree: 'badge-success',
  sortie: 'badge-danger',
  pause_debut: 'badge-warning',
  pause_fin: 'badge-info',
};

export function TimeLogsPage() {
  const qc = useQueryClient();
  const [note, setNote] = useState('');
  const [gps, setGps] = useState<{ lat: number; lng: number } | null>(null);
  const [geoError, setGeoError] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const logs = useQuery({
    queryKey: ['timelogs'],
    queryFn: async () => (await api.get<{ logs: TimeLog[] }>('/timelogs')).data.logs,
  });

  const summary = useMemo(() => {
    const rows = logs.data ?? [];
    return {
      total: rows.length,
      entries: rows.filter((row) => row.type === 'entree').length,
      exits: rows.filter((row) => row.type === 'sortie').length,
      last: rows[0] ?? null,
    };
  }, [logs.data]);

  const capturePosition = async () => {
    if (!navigator.geolocation) {
      setGeoError('Geolocalisation indisponible sur ce navigateur');
      return;
    }
    setGeoError(null);
    await new Promise<void>((resolve) => {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          setGps({
            lat: Number(position.coords.latitude.toFixed(6)),
            lng: Number(position.coords.longitude.toFixed(6)),
          });
          resolve();
        },
        (error) => {
          setGeoError(error.message || 'Impossible de lire la position');
          resolve();
        },
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 },
      );
    });
  };

  const addLog = useMutation({
    mutationFn: async (type: TimeLogType) => {
      await api.post('/timelogs', {
        type,
        note: note || undefined,
        gps: gps ? { lat: gps.lat, lng: gps.lng } : undefined,
      });
    },
    onSuccess: () => {
      setErr(null);
      setNote('');
      qc.invalidateQueries({ queryKey: ['timelogs'] });
    },
    onError: (error) => setErr(apiError(error).message),
  });

  return (
    <>
      <PageHeader title="Pointage employes" subtitle="Entree, sortie et pauses avec capture GPS optionnelle" />

      <section className="mb-5 grid gap-4 md:grid-cols-4">
        <MetricCard label="Total pointages" value={String(summary.total)} />
        <MetricCard label="Entrees" value={String(summary.entries)} />
        <MetricCard label="Sorties" value={String(summary.exits)} />
        <MetricCard label="Dernier pointage" value={summary.last ? labels[summary.last.type] : 'Aucun'} />
      </section>

      <section className="card mb-5 p-4">
        <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_180px]">
          <input
            className="input"
            placeholder="Note (optionnelle)"
            value={note}
            onChange={(event) => setNote(event.target.value)}
          />
          <button className="btn-secondary" onClick={capturePosition}>
            Capturer GPS
          </button>
        </div>
        {gps && <div className="mt-2 text-sm text-slate-600">GPS: {gps.lat}, {gps.lng}</div>}
        {geoError && <div className="mt-2 text-sm text-rose-600">{geoError}</div>}
        {err && <div className="mt-2 text-sm text-rose-600">{err}</div>}
      </section>

      <section className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {(Object.keys(labels) as TimeLogType[]).map((type) => (
          <button
            key={type}
            className="btn-primary !justify-start !px-4 !py-3"
            disabled={addLog.isPending}
            onClick={() => addLog.mutate(type)}
          >
            Pointer: {labels[type]}
          </button>
        ))}
      </section>

      <section className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr>
              <th className="th">Date</th>
              <th className="th">Type</th>
              <th className="th">GPS</th>
              <th className="th">Note</th>
              <th className="th">Appareil</th>
            </tr>
          </thead>
          <tbody>
            {(logs.data ?? []).map((log) => (
              <tr key={log._id}>
                <td className="td">{dateTime(log.timestamp)}</td>
                <td className="td">
                  <span className={badgeByType[log.type]}>{labels[log.type]}</span>
                </td>
                <td className="td text-slate-600">
                  {log.gps?.lat != null && log.gps?.lng != null ? `${log.gps.lat}, ${log.gps.lng}` : '-'}
                </td>
                <td className="td text-slate-600">{log.note || '-'}</td>
                <td className="td text-xs text-slate-500">{log.device || '-'}</td>
              </tr>
            ))}
            {!logs.isLoading && (logs.data?.length ?? 0) === 0 && (
              <tr>
                <td className="td text-slate-400" colSpan={5}>
                  Aucun pointage pour le moment.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>
    </>
  );
}

function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="card p-4">
      <div className="text-xs uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-1 text-2xl font-semibold text-slate-900">{value}</div>
    </div>
  );
}
