import { useQuery } from '@tanstack/react-query';
import { Download, MapPinned, ShieldCheck, Smartphone, Wifi } from 'lucide-react';
import { PageHeader } from '../components/PageHeader';
import { api, apiError } from '../lib/api';

interface MobileAppManifest {
  app: {
    name: string;
    platform: 'android';
    filename: string;
    version: string;
    apiBaseUrl: string | null;
    targetRoles: string[];
    available: boolean;
    sizeBytes: number;
    updatedAt: string | null;
    downloadUrl: string;
  };
}

function formatBytes(value: number) {
  if (!Number.isFinite(value) || value <= 0) return '-';
  if (value >= 1024 * 1024) return `${(value / 1024 / 1024).toFixed(1)} MB`;
  if (value >= 1024) return `${Math.round(value / 1024)} KB`;
  return `${value} B`;
}

function formatDate(value: string | null) {
  if (!value) return '-';
  return new Date(value).toLocaleString();
}

export function MobileAppPage() {
  const manifest = useQuery({
    queryKey: ['mobile-app-manifest'],
    queryFn: async () => (await api.get<MobileAppManifest>('/mobile-app/manifest')).data.app,
  });
  const app = manifest.data;

  return (
    <>
      <PageHeader
        title="Application mobile"
        subtitle="APK Android pour pointage siege et commerciaux terrain"
      />

      {manifest.isError && (
        <section className="mb-5 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {apiError(manifest.error).message}
        </section>
      )}

      <section className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="card overflow-hidden">
          <div className="border-b border-surface-200 bg-surface-50 px-4 py-4">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div className="flex min-w-0 items-start gap-3">
                <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-lg bg-brand-600 text-white">
                  <Smartphone className="h-6 w-6" />
                </div>
                <div className="min-w-0">
                  <h2 className="text-base font-bold text-surface-900">{app?.name ?? 'ASEL Pointage'}</h2>
                  <p className="mt-1 text-sm text-surface-500">
                    Serveur mobile: {app?.apiBaseUrl ?? 'configuration production en attente'}
                  </p>
                </div>
              </div>
              <a
                href={app?.downloadUrl ?? '#'}
                className={`btn-primary ${!app?.available ? 'pointer-events-none opacity-50' : ''}`}
                aria-disabled={!app?.available}
              >
                <Download className="h-4 w-4" />
                Télécharger APK
              </a>
            </div>
          </div>

          <div className="grid gap-3 p-4 sm:grid-cols-3">
            <InfoTile label="Version" value={manifest.isLoading ? '...' : app?.version ?? '-'} />
            <InfoTile label="Taille" value={manifest.isLoading ? '...' : formatBytes(app?.sizeBytes ?? 0)} />
            <InfoTile label="Mis a jour" value={manifest.isLoading ? '...' : formatDate(app?.updatedAt ?? null)} />
          </div>

          {!manifest.isLoading && !app?.available && (
            <div className="mx-4 mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-800">
              APK indisponible sur le serveur. Generez le build Android puis redeployez le backend.
            </div>
          )}

          <div className="border-t border-surface-200 p-4">
            <h3 className="text-sm font-bold text-surface-900">Installation Android</h3>
            <div className="mt-3 grid gap-3 md:grid-cols-3">
              <StepCard title="1. Ouvrir" text="Connectez-vous au site avec un compte autorise depuis le telephone Android." />
              <StepCard title="2. Installer" text="Telechargez l'APK, puis autorisez l'installation si Android le demande." />
              <StepCard title="3. Se connecter" text="L'application pointe vers le serveur VPS ASEL en production." />
            </div>
          </div>
        </div>

        <aside className="space-y-4">
          <div className="card p-4">
            <div className="flex items-center gap-2 text-sm font-bold text-surface-900">
              <ShieldCheck className="h-4 w-4 text-emerald-600" />
              Acces controle
            </div>
            <p className="mt-2 text-sm text-surface-600">
              Le fichier est servi par l'API avec session obligatoire. Les roles non cibles ne peuvent pas le telecharger.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              {(app?.targetRoles ?? ['commercial', 'siege_employee', 'hr_admin']).map((role) => (
                <span key={role} className="badge-muted capitalize">{role}</span>
              ))}
            </div>
          </div>

          <div className="card p-4">
            <div className="flex items-center gap-2 text-sm font-bold text-surface-900">
              <MapPinned className="h-4 w-4 text-brand-600" />
              Terrain
            </div>
            <p className="mt-2 text-sm text-surface-600">
              Les commerciaux utilisent la carte, les points reseau, le pointage et le suivi GPS de travail.
            </p>
          </div>

          <div className="card p-4">
            <div className="flex items-center gap-2 text-sm font-bold text-surface-900">
              <Wifi className="h-4 w-4 text-sky-600" />
              Sync
            </div>
            <p className="mt-2 text-sm text-surface-600">
              Le pointage et les positions se mettent en file d'attente quand la connexion est faible.
            </p>
          </div>
        </aside>
      </section>
    </>
  );
}

function InfoTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-surface-200 bg-white px-3 py-3">
      <div className="text-xs font-semibold uppercase tracking-wide text-surface-500">{label}</div>
      <div className="mt-1 break-words text-sm font-bold text-surface-900">{value}</div>
    </div>
  );
}

function StepCard({ title, text }: { title: string; text: string }) {
  return (
    <div className="rounded-lg border border-surface-200 bg-surface-50 px-3 py-3">
      <div className="text-sm font-bold text-surface-900">{title}</div>
      <p className="mt-1 text-sm text-surface-600">{text}</p>
    </div>
  );
}
