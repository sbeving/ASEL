import { Link } from 'react-router-dom';

export function NotFoundPage() {
  return (
    <div className="min-h-[60vh] flex items-center justify-center">
      <div className="text-center">
        <div className="text-7xl font-bold text-slate-300">404</div>
        <h1 className="mt-3 text-xl font-semibold text-slate-900">Page introuvable</h1>
        <p className="mt-1 text-sm text-slate-500">Cette page n’existe pas ou a été déplacée.</p>
        <Link to="/" className="btn-primary inline-flex mt-6">Retour au tableau de bord</Link>
      </div>
    </div>
  );
}
