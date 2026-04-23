import { useState } from 'react';

export default function PasswordModal({ onSuccess }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      // Validate password by making a lightweight request with the header
      const res = await fetch('/api/health');
      if (!res.ok) throw new Error('Error del servidor');
      // We can't truly validate password without an endpoint — just pass it along
      // Real validation happens server-side on admin operations
      if (!password.trim()) {
        setError('Introduce la contraseña');
        return;
      }
      onSuccess(password);
    } catch {
      setError('Error de conexión con el servidor');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-sm mx-4">
        <div className="bg-navy rounded-t-xl px-6 py-4">
          <h2 className="text-white font-semibold text-lg">Acceso restringido</h2>
          <p className="text-blue-200 text-sm mt-0.5">Zona de administración de tarifas</p>
        </div>
        <form onSubmit={handleSubmit} className="p-6">
          <label className="block text-sm font-medium text-gray-700 mb-1">Contraseña</label>
          <input
            type="password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-navy focus:border-transparent"
            placeholder="Contraseña de administrador"
            autoFocus
          />
          {error && (
            <p className="mt-2 text-sm text-red-600">{error}</p>
          )}
          <button
            type="submit"
            disabled={loading}
            className="mt-4 w-full bg-navy text-white font-medium py-2 rounded-lg hover:bg-navy-light transition-colors disabled:opacity-50"
          >
            {loading ? 'Verificando...' : 'Acceder'}
          </button>
        </form>
      </div>
    </div>
  );
}
