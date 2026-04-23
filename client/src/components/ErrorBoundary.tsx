import { Component, type ReactNode } from 'react';

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: unknown) {
    console.error('UI error boundary:', error, info);
  }

  private reset = () => {
    this.setState({ error: null });
    window.location.href = '/';
  };

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="min-h-screen flex items-center justify-center p-4 bg-slate-50">
        <div className="card max-w-md w-full p-6 text-center">
          <h1 className="text-lg font-semibold text-slate-900 mb-2">
            Une erreur est survenue
          </h1>
          <p className="text-sm text-slate-500 mb-4">
            L’application a rencontré un problème inattendu. Vos données sont en sécurité.
          </p>
          <pre className="text-xs text-left bg-slate-100 rounded p-3 mb-4 max-h-40 overflow-auto text-slate-700">
            {this.state.error.message}
          </pre>
          <button className="btn-primary w-full" onClick={this.reset}>
            Retour à l’accueil
          </button>
        </div>
      </div>
    );
  }
}
