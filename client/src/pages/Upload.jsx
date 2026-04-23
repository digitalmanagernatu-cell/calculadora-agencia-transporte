import { useState, useEffect } from 'react';
import PasswordModal from '../components/PasswordModal';

const SCOPE_OPTIONS = [
  { value: 'nacional', label: 'Nacional' },
  { value: 'internacional', label: 'Internacional' },
  { value: 'ambas', label: 'Ambas (nacional + internacional en el mismo archivo)' },
];

export default function Upload() {
  const [authenticated, setAuthenticated] = useState(false);
  const [adminPassword, setAdminPassword] = useState('');

  const [agencies, setAgencies] = useState([]);
  const [form, setForm] = useState({
    agency_id: '',
    new_agency_name: '',
    scope: 'nacional',
    file: null,
  });
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!authenticated) return;
    fetch('/api/agencies')
      .then(r => r.json())
      .then(data => {
        setAgencies(data);
        if (data.length > 0) setForm(prev => ({ ...prev, agency_id: String(data[0].id) }));
      });
  }, [authenticated]);

  function handleAuth(password) {
    setAdminPassword(password);
    setAuthenticated(true);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setResult(null);
    setError(null);

    if (!form.file) {
      setError('Selecciona un archivo .xlsx');
      return;
    }
    if (!form.agency_id && !form.new_agency_name.trim()) {
      setError('Selecciona una agencia o introduce el nombre de la nueva');
      return;
    }

    setSubmitting(true);
    try {
      const data = new FormData();
      data.append('file', form.file);
      data.append('scope', form.scope);
      if (form.agency_id && form.agency_id !== '__new__') {
        data.append('agency_id', form.agency_id);
      } else {
        data.append('new_agency_name', form.new_agency_name.trim());
      }

      const res = await fetch('/api/tariffs/upload', {
        method: 'POST',
        headers: { 'x-admin-password': adminPassword },
        body: data,
      });

      const json = await res.json();
      if (!res.ok) {
        if (res.status === 401) {
          setAuthenticated(false);
          setError('Contraseña incorrecta. Vuelve a introducirla.');
        } else {
          throw new Error(json.error || 'Error al subir el archivo');
        }
        return;
      }

      setResult(json);
      setForm(prev => ({ ...prev, file: null }));
      // Reload agencies in case new one was created
      const updatedAgencies = await fetch('/api/agencies').then(r => r.json());
      setAgencies(updatedAgencies);
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  const isNewAgency = form.agency_id === '__new__';

  return (
    <div>
      {!authenticated && <PasswordModal onSuccess={handleAuth} />}

      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Gestión de tarifas</h1>
        <p className="text-gray-500 mt-1">Sube o actualiza las tarifas de las agencias de transporte</p>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 max-w-2xl">
        <form onSubmit={handleSubmit} className="space-y-5">
          {/* Agency selector */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Agencia</label>
            <select
              value={form.agency_id}
              onChange={e => setForm(prev => ({ ...prev, agency_id: e.target.value, new_agency_name: '' }))}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-navy bg-white text-sm"
            >
              {agencies.map(a => (
                <option key={a.id} value={a.id}>{a.display_name}</option>
              ))}
              <option value="__new__">+ Añadir nueva agencia</option>
            </select>
          </div>

          {/* New agency name */}
          {isNewAgency && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Nombre de la nueva agencia</label>
              <input
                type="text"
                value={form.new_agency_name}
                onChange={e => setForm(prev => ({ ...prev, new_agency_name: e.target.value }))}
                placeholder="Ej: MRW"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-navy text-sm"
              />
              <p className="mt-1 text-xs text-gray-400">El archivo se procesará con el parser genérico si la agencia no es reconocida.</p>
            </div>
          )}

          {/* Scope */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Tipo de tarifa</label>
            <div className="space-y-2">
              {SCOPE_OPTIONS.map(opt => (
                <label key={opt.value} className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name="scope"
                    value={opt.value}
                    checked={form.scope === opt.value}
                    onChange={() => setForm(prev => ({ ...prev, scope: opt.value }))}
                    className="accent-navy"
                  />
                  <span className="text-sm text-gray-700">{opt.label}</span>
                </label>
              ))}
            </div>
          </div>

          {/* File input */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Archivo Excel (.xlsx)</label>
            <input
              type="file"
              accept=".xlsx"
              onChange={e => setForm(prev => ({ ...prev, file: e.target.files?.[0] || null }))}
              className="block w-full text-sm text-gray-600 file:mr-3 file:py-1.5 file:px-3 file:rounded file:border-0 file:text-sm file:font-medium file:bg-navy file:text-white hover:file:bg-navy-light cursor-pointer"
            />
            {form.file && (
              <p className="mt-1 text-xs text-gray-500">Archivo seleccionado: {form.file.name}</p>
            )}
          </div>

          {error && (
            <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-red-700 text-sm">
              {error}
            </div>
          )}

          {result && (
            <div className={`rounded-lg px-4 py-3 text-sm border ${result.warning ? 'bg-amber-50 border-amber-200 text-amber-800' : 'bg-green-50 border-green-200 text-green-800'}`}>
              <p className="font-medium">
                ✓ Tarifa importada correctamente — {result.recordsInserted} registros insertados
              </p>
              {result.warning && (
                <p className="mt-1 text-amber-700">{result.warning}</p>
              )}
            </div>
          )}

          <div className="flex gap-3">
            <button
              type="submit"
              disabled={submitting}
              className="bg-navy text-white font-semibold px-6 py-2.5 rounded-lg hover:bg-navy-light transition-colors disabled:opacity-50 flex items-center gap-2 text-sm"
            >
              {submitting ? (
                <>
                  <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
                  </svg>
                  Procesando...
                </>
              ) : 'Subir tarifa'}
            </button>
          </div>
        </form>

        <div className="mt-6 pt-4 border-t border-gray-100">
          <p className="text-xs text-gray-400">
            Al subir un archivo, se reemplazarán todas las tarifas actuales de la agencia y tipo seleccionados.
          </p>
        </div>
      </div>
    </div>
  );
}
