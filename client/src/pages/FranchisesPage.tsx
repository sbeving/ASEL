import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { api, apiError } from '../lib/api';
import { ContactActions } from '../components/ContactActions';
import { PageHeader } from '../components/PageHeader';
import { Modal } from '../components/Modal';
import { useAuth } from '../auth/AuthContext';
import type { Franchise } from '../lib/types';

const dayOptions = [
  { value: '1', label: 'Lun' },
  { value: '2', label: 'Mar' },
  { value: '3', label: 'Mer' },
  { value: '4', label: 'Jeu' },
  { value: '5', label: 'Ven' },
  { value: '6', label: 'Sam' },
  { value: '0', label: 'Dim' },
];

const schema = z.object({
  name: z.string().min(1).max(100),
  address: z.string().max(255).optional(),
  phone: z.string().max(50).optional(),
  manager: z.string().max(100).optional(),
  taxId: z.string().max(80).optional(),
  gpsLat: z
    .string()
    .optional()
    .refine(
      (value) =>
        value == null ||
        value === '' ||
        (!Number.isNaN(Number(value)) &&
          Number(value) >= -90 &&
          Number(value) <= 90),
      { message: 'Latitude invalide' },
    ),
  gpsLng: z
    .string()
    .optional()
    .refine(
      (value) =>
        value == null ||
        value === '' ||
        (!Number.isNaN(Number(value)) &&
          Number(value) >= -180 &&
          Number(value) <= 180),
      { message: 'Longitude invalide' },
    ),
  active: z.boolean().optional(),
  workEnabled: z.boolean().optional(),
  workDays: z.array(z.string()).min(1, 'Choisissez au moins un jour'),
  workStartTime: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Heure invalide'),
  workEndTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Heure invalide'),
  workTimezone: z.string().min(1).max(80),
  creditPolicyEnabled: z.boolean().optional(),
  minimumScoreForInstallment: z.coerce.number().min(0).max(100),
  blockRiskyTier: z.boolean().optional(),
  blockLateInstallments: z.boolean().optional(),
  maxDebtToRecommendedLimitRatio: z.coerce.number().min(0).max(5),
  maxMonthlyPaymentRatio: z.coerce.number().min(0).max(5),
});
type FormValues = z.infer<typeof schema>;

function scheduleLabel(franchise: Franchise): string {
  const schedule = franchise.workSchedule;
  if (!schedule?.enabled) return 'Desactive';
  const days = (schedule?.days ?? [1, 2, 3, 4, 5, 6])
    .map(
      (day) => dayOptions.find((option) => option.value === String(day))?.label,
    )
    .filter(Boolean)
    .join(', ');
  return `${days}: ${schedule?.startTime ?? '09:00'}-${schedule?.endTime ?? '19:00'}`;
}

function creditPolicyLabel(franchise: Franchise): string {
  const policy = franchise.creditPolicy;
  if (!policy?.enabled) return 'Desactive';
  return `Score min ${policy?.minimumScoreForInstallment ?? 50}, dette x${policy?.maxDebtToRecommendedLimitRatio ?? 1}`;
}

export function FranchisesPage() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [editing, setEditing] = useState<Franchise | null>(null);
  const [creating, setCreating] = useState(false);
  const canCreate = user?.role === 'admin' || user?.role === 'superadmin';
  const scheduleOnly = user?.role === 'franchise';

  const list = useQuery({
    queryKey: ['franchises'],
    queryFn: async () =>
      (await api.get<{ franchises: Franchise[] }>('/franchises')).data
        .franchises,
  });

  return (
    <>
      <PageHeader
        title="Franchises"
        actions={
          canCreate ? (
            <button className="btn-primary" onClick={() => setCreating(true)}>
              + Nouvelle franchise
            </button>
          ) : undefined
        }
      />
      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr>
              <th className="th">Nom</th>
              <th className="th">Adresse</th>
              <th className="th">Telephone</th>
              <th className="th">Matricule fiscale</th>
              <th className="th">Responsable</th>
              <th className="th">Horaires</th>
              <th className="th">Credit</th>
              <th className="th">Coordonnees</th>
              <th className="th">Statut</th>
              <th className="th"></th>
            </tr>
          </thead>
          <tbody>
            {(list.data ?? []).map((franchise) => (
              <tr key={franchise._id}>
                <td className="td font-medium">{franchise.name}</td>
                <td className="td text-slate-500">
                  {franchise.address ?? '—'}
                </td>
                <td className="td text-slate-500">
                  <div>{franchise.phone ?? '—'}</div>
                  <ContactActions
                    phone={franchise.phone}
                    message={`Bonjour ${franchise.name}, ici ASEL Mobile Tunisie.`}
                    compact
                    className="mt-2"
                  />
                </td>
                <td className="td text-slate-500">{franchise.taxId || '—'}</td>
                <td className="td text-slate-500">
                  {franchise.manager ?? '—'}
                </td>
                <td className="td text-slate-500">
                  {scheduleLabel(franchise)}
                </td>
                <td className="td text-slate-500">
                  {creditPolicyLabel(franchise)}
                </td>
                <td className="td text-slate-500">
                  {franchise.gps?.lat != null && franchise.gps?.lng != null
                    ? `${franchise.gps.lat}, ${franchise.gps.lng}`
                    : '—'}
                </td>
                <td className="td">
                  {franchise.active ? (
                    <span className="badge-success">actif</span>
                  ) : (
                    <span className="badge-muted">inactif</span>
                  )}
                </td>
                <td className="td-action">
                  <button
                    className="text-brand-600 hover:underline"
                    onClick={() => setEditing(franchise)}
                  >
                    Modifier
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {(creating || editing) && (
        <FranchiseForm
          initial={editing}
          scheduleOnly={scheduleOnly}
          onClose={() => {
            setCreating(false);
            setEditing(null);
          }}
          onSaved={() => {
            qc.invalidateQueries({ queryKey: ['franchises'] });
            setCreating(false);
            setEditing(null);
          }}
        />
      )}
    </>
  );
}

function FranchiseForm({
  initial,
  scheduleOnly,
  onClose,
  onSaved,
}: {
  initial: Franchise | null;
  scheduleOnly?: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: initial
      ? {
          name: initial.name,
          address: initial.address ?? '',
          phone: initial.phone ?? '',
          manager: initial.manager ?? '',
          taxId: initial.taxId ?? '',
          gpsLat: initial.gps?.lat != null ? String(initial.gps.lat) : '',
          gpsLng: initial.gps?.lng != null ? String(initial.gps.lng) : '',
          active: initial.active,
          workEnabled: initial.workSchedule?.enabled ?? true,
          workDays: (initial.workSchedule?.days ?? [1, 2, 3, 4, 5, 6]).map(
            String,
          ),
          workStartTime: initial.workSchedule?.startTime ?? '09:00',
          workEndTime: initial.workSchedule?.endTime ?? '19:00',
          workTimezone: initial.workSchedule?.timezone ?? 'Africa/Tunis',
          creditPolicyEnabled: initial.creditPolicy?.enabled ?? true,
          minimumScoreForInstallment:
            initial.creditPolicy?.minimumScoreForInstallment ?? 50,
          blockRiskyTier: initial.creditPolicy?.blockRiskyTier ?? true,
          blockLateInstallments:
            initial.creditPolicy?.blockLateInstallments ?? true,
          maxDebtToRecommendedLimitRatio:
            initial.creditPolicy?.maxDebtToRecommendedLimitRatio ?? 1,
          maxMonthlyPaymentRatio:
            initial.creditPolicy?.maxMonthlyPaymentRatio ?? 1,
        }
      : {
          name: '',
          address: '',
          phone: '',
          manager: '',
          taxId: '',
          gpsLat: '',
          gpsLng: '',
          active: true,
          workEnabled: true,
          workDays: ['1', '2', '3', '4', '5', '6'],
          workStartTime: '09:00',
          workEndTime: '19:00',
          workTimezone: 'Africa/Tunis',
          creditPolicyEnabled: true,
          minimumScoreForInstallment: 50,
          blockRiskyTier: true,
          blockLateInstallments: true,
          maxDebtToRecommendedLimitRatio: 1,
          maxMonthlyPaymentRatio: 1,
        },
  });

  const save = useMutation({
    mutationFn: async (values: FormValues) => {
      const latRaw = values.gpsLat?.trim() ?? '';
      const lngRaw = values.gpsLng?.trim() ?? '';
      const hasLat = latRaw.length > 0;
      const hasLng = lngRaw.length > 0;
      if (hasLat !== hasLng) {
        throw new Error('Renseignez latitude et longitude ensemble');
      }
      const workSchedule = {
        enabled: values.workEnabled ?? true,
        days: values.workDays.map(Number),
        startTime: values.workStartTime,
        endTime: values.workEndTime,
        timezone: values.workTimezone,
      };
      const creditPolicy = {
        enabled: values.creditPolicyEnabled ?? true,
        minimumScoreForInstallment: values.minimumScoreForInstallment,
        blockRiskyTier: values.blockRiskyTier ?? true,
        blockLateInstallments: values.blockLateInstallments ?? true,
        maxDebtToRecommendedLimitRatio: values.maxDebtToRecommendedLimitRatio,
        maxMonthlyPaymentRatio: values.maxMonthlyPaymentRatio,
      };
      if (scheduleOnly) {
        if (!initial) throw new Error('Franchise requise');
        await api.patch(`/franchises/${initial._id}`, { workSchedule });
        return;
      }
      const payload = {
        name: values.name,
        address: values.address,
        phone: values.phone,
        manager: values.manager,
        taxId: values.taxId,
        gps:
          hasLat && hasLng
            ? { lat: Number(latRaw), lng: Number(lngRaw) }
            : null,
        workSchedule,
        creditPolicy,
        active: values.active,
      };
      if (initial) await api.patch(`/franchises/${initial._id}`, payload);
      else await api.post('/franchises', payload);
    },
    onSuccess: onSaved,
    onError: (err) =>
      setError(err instanceof Error ? err.message : apiError(err).message),
  });

  return (
    <Modal
      open
      title={
        scheduleOnly
          ? 'Horaires de travail'
          : initial
            ? 'Modifier la franchise'
            : 'Nouvelle franchise'
      }
      onClose={onClose}
      footer={
        <div className="flex justify-end gap-2">
          <button className="btn-secondary" onClick={onClose}>
            Annuler
          </button>
          <button
            className="btn-primary"
            form="franchise-form"
            disabled={isSubmitting || save.isPending}
          >
            {isSubmitting || save.isPending
              ? 'Enregistrement...'
              : 'Enregistrer'}
          </button>
        </div>
      }
    >
      <form
        id="franchise-form"
        className="grid gap-3 sm:grid-cols-2"
        onSubmit={handleSubmit((values) => save.mutate(values))}
      >
        {!scheduleOnly && (
          <>
            <div className="sm:col-span-2">
              <label className="label">Nom</label>
              <input className="input" {...register('name')} />
              {errors.name && (
                <p className="mt-1 text-xs text-rose-600">
                  {errors.name.message}
                </p>
              )}
            </div>
            <div className="sm:col-span-2">
              <label className="label">Adresse</label>
              <input className="input" {...register('address')} />
            </div>
            <div>
              <label className="label">Telephone</label>
              <input className="input" {...register('phone')} />
            </div>
            <div>
              <label className="label">Responsable</label>
              <input className="input" {...register('manager')} />
            </div>
            <div className="sm:col-span-2">
              <label className="label">Matricule fiscale</label>
              <input
                className="input"
                placeholder="Ex: 1234567/A/M/000"
                {...register('taxId')}
              />
            </div>
            <div>
              <label className="label">Latitude</label>
              <input
                className="input"
                placeholder="36.867179"
                {...register('gpsLat')}
              />
              {errors.gpsLat && (
                <p className="mt-1 text-xs text-rose-600">
                  {errors.gpsLat.message}
                </p>
              )}
            </div>
            <div>
              <label className="label">Longitude</label>
              <input
                className="input"
                placeholder="10.250789"
                {...register('gpsLng')}
              />
              {errors.gpsLng && (
                <p className="mt-1 text-xs text-rose-600">
                  {errors.gpsLng.message}
                </p>
              )}
            </div>
            <label className="inline-flex items-center gap-2 text-sm sm:col-span-2">
              <input type="checkbox" {...register('active')} />
              Actif
            </label>
          </>
        )}
        <div className="sm:col-span-2 rounded-lg border border-slate-200 p-3">
          <label className="inline-flex items-center gap-2 text-sm font-semibold text-slate-800">
            <input type="checkbox" {...register('workEnabled')} />
            Pointage automatique actif pendant ces horaires
          </label>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <div>
              <label className="label">Debut</label>
              <input
                type="time"
                className="input"
                {...register('workStartTime')}
              />
              {errors.workStartTime && (
                <p className="mt-1 text-xs text-rose-600">
                  {errors.workStartTime.message}
                </p>
              )}
            </div>
            <div>
              <label className="label">Fin</label>
              <input
                type="time"
                className="input"
                {...register('workEndTime')}
              />
              {errors.workEndTime && (
                <p className="mt-1 text-xs text-rose-600">
                  {errors.workEndTime.message}
                </p>
              )}
            </div>
          </div>
          <div className="mt-3">
            <label className="label">Jours ouvrables</label>
            <div className="grid grid-cols-4 gap-2 sm:grid-cols-7">
              {dayOptions.map((day) => (
                <label
                  key={day.value}
                  className="inline-flex items-center justify-center gap-1 rounded-lg border border-slate-200 px-2 py-2 text-xs font-semibold"
                >
                  <input
                    type="checkbox"
                    value={day.value}
                    {...register('workDays')}
                  />
                  {day.label}
                </label>
              ))}
            </div>
            {errors.workDays && (
              <p className="mt-1 text-xs text-rose-600">
                {errors.workDays.message}
              </p>
            )}
          </div>
          <div className="mt-3">
            <label className="label">Fuseau horaire</label>
            <input
              className="input"
              placeholder="Africa/Tunis"
              {...register('workTimezone')}
            />
            {errors.workTimezone && (
              <p className="mt-1 text-xs text-rose-600">
                {errors.workTimezone.message}
              </p>
            )}
          </div>
        </div>
        {!scheduleOnly && (
          <div className="sm:col-span-2 rounded-lg border border-slate-200 p-3">
            <label className="inline-flex items-center gap-2 text-sm font-semibold text-slate-800">
              <input type="checkbox" {...register('creditPolicyEnabled')} />
              Regles credit echeances actives
            </label>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <div>
                <label className="label">Score minimum</label>
                <input
                  type="number"
                  min={0}
                  max={100}
                  className="input"
                  {...register('minimumScoreForInstallment')}
                />
              </div>
              <div>
                <label className="label">Dette / plafond recommande</label>
                <input
                  type="number"
                  min={0}
                  max={5}
                  step="0.1"
                  className="input"
                  {...register('maxDebtToRecommendedLimitRatio')}
                />
              </div>
              <div>
                <label className="label">Mensualite / capacite</label>
                <input
                  type="number"
                  min={0}
                  max={5}
                  step="0.1"
                  className="input"
                  {...register('maxMonthlyPaymentRatio')}
                />
              </div>
              <label className="checkbox-field">
                <input type="checkbox" {...register('blockRiskyTier')} />
                Bloquer score risque
              </label>
              <label className="checkbox-field">
                <input type="checkbox" {...register('blockLateInstallments')} />
                Bloquer client en retard
              </label>
            </div>
          </div>
        )}
        {error && (
          <div className="sm:col-span-2 rounded-lg bg-rose-50 border border-rose-200 px-3 py-2 text-sm text-rose-700">
            {error}
          </div>
        )}
      </form>
    </Modal>
  );
}
