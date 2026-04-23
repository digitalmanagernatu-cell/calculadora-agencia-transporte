import { useState, useEffect } from 'react';
import AgencyResult from '../components/AgencyResult';

const INITIAL_FORM = {
  weight_kg: '',
  destination_type: 'nacional',
  postal_code: '',
  country: '',
};

// Normalize accents for deduplication comparison
function normalizeAccents(s) {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}

export default function Calculator() {
  const [form, setForm] = useState(INITIAL_FORM);
  const [results, setResults] = useState(null);
  const [countriesList, setCountriesList] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [validationErrors, setValidationErrors] = useState({});

  useEffect(() => {
    fetch('/api/calculator/countries')
      .then(r => r.json())
      .then(data => {
        // Deduplicate by normalized key (no accents), keeping the accented version when possible
        const seen = new Map();
        for (const name of data) {
          const key = normalizeAccents(name);
          const existing = seen.get(key);
          if (!existing || (name !== normalizeAccents(name) && existing === normalizeAccents(existing))) {
            seen.set(key, name);
          }
        }
        setCountriesList([...seen.values()].sort((a, b) => a.localeCompare(b, 'es')));
      })
      .catch(() => {});
  }, []);

  function validate() {
    const errors = {};
    if (!form.weight_kg || isNaN(parseFloat(form.weight_kg)) || parseFloat(form.weight_kg) < 0.1) {
      errors.weight_kg = 'Introduce un peso válido (mínimo 0.1 kg)';
    }
    if (form.destination_type === 'nacional') {
      if (!form.postal_code || !/^\d{4,5}$/.test(form.postal_code)) {
        errors.postal_code = 'El código postal debe tener 4 dígitos (Portugal) o 5 dígitos (España)';
      }
    } else {
      if (!form.country) {
        errors.country = 'Selecciona un país de destino';
      }
    }
    return errors;
  }

  async function handleSubmit(e) {
    e.preventDefault();
    const errors = validate();
    setValidationErrors(errors);
    if (Object.keys(errors).length > 0) return;

    setLoading(true);
    setError(null);
    setResults(null);

    try {
      const body = {
        weight_kg: parseFloat(form.weight_kg),
        destination_type: form.destination_type,
      };
      if (form.destination_type === 'nacional') {
        body.postal_code = form.postal_code;
      } else {
        body.country = form.country;
      }

      const res = await fetch('/api/calculator/quote', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Error al calcular');
      setResults(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  function handleChange(field, value) {
    setForm(prev => ({ ...prev, [field]: value }));
    if (validationErrors[field]) {
      setValidationErrors(prev => { const n = { ...prev }; delete n[field]; return n; });
    }
  }

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Calculadora de envíos</h1>
        <p className="text-gray-500 mt-1">Consulta la tarifa más competitiva para tu envío</p>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 mb-6">
        <form onSubmit={handleSubmit} className="space-y-5">
          {/* Weight */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Peso del envío (kg)
            </label>
            <input
              type="number"
              step="0.1"
              min="0.1"
              value={form.weight_kg}
              onChange={e => handleChange('weight_kg', e.target.value)}
              placeholder="Ej: 5.5"
              className={`w-full sm:w-48 border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-navy focus:border-transparent ${
                validationErrors.weight_kg ? 'border-red-400' : 'border-gray-300'
              }`}
            />
            {validationErrors.weight_kg && (
              <p className="mt-1 text-xs text-red-600">{validationErrors.weight_kg}</p>
            )}
          </div>

          {/* Destination type */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Tipo de destino</label>
            <div className="flex flex-col gap-2">
              <label className="flex items-start gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="destination_type"
                  value="nacional"
                  checked={form.destination_type === 'nacional'}
                  onChange={() => handleChange('destination_type', 'nacional')}
                  className="accent-navy mt-0.5"
                />
                <div>
                  <span className="text-sm text-gray-700 font-medium">Peninsular</span>
                  <span className="text-xs text-gray-400 ml-2">España + Portugal</span>
                </div>
              </label>
              <label className="flex items-start gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="destination_type"
                  value="internacional"
                  checked={form.destination_type === 'internacional'}
                  onChange={() => handleChange('destination_type', 'internacional')}
                  className="accent-navy mt-0.5"
                />
                <div>
                  <span className="text-sm text-gray-700 font-medium">Internacional</span>
                  <span className="text-xs text-gray-400 ml-2">Resto del mundo (Francia, Italia, Alemania...)</span>
                </div>
              </label>
            </div>
          </div>

          {/* Postal code or country */}
          {form.destination_type === 'nacional' ? (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Código postal de destino</label>
              <input
                type="text"
                maxLength={5}
                value={form.postal_code}
                onChange={e => handleChange('postal_code', e.target.value.replace(/\D/g, ''))}
                placeholder="Ej: 28001 (España) o 1000 (Portugal)"
                className={`w-full sm:w-56 border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-navy focus:border-transparent ${
                  validationErrors.postal_code ? 'border-red-400' : 'border-gray-300'
                }`}
              />
              <p className="mt-1 text-xs text-gray-400">CPs españoles: 5 dígitos. CPs portugueses: 4 dígitos (ej: 1000 Lisboa)</p>
              {validationErrors.postal_code && (
                <p className="mt-1 text-xs text-red-600">{validationErrors.postal_code}</p>
              )}
            </div>
          ) : (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">País de destino</label>
              <select
                value={form.country}
                onChange={e => handleChange('country', e.target.value)}
                className={`w-full sm:w-72 border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-navy focus:border-transparent bg-white ${
                  validationErrors.country ? 'border-red-400' : 'border-gray-300'
                }`}
              >
                <option value="">— Selecciona un destino —</option>
                {countriesList.map(c => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
              {validationErrors.country && (
                <p className="mt-1 text-xs text-red-600">{validationErrors.country}</p>
              )}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="bg-navy text-white font-semibold px-6 py-2.5 rounded-lg hover:bg-navy-light transition-colors disabled:opacity-50 flex items-center gap-2"
          >
            {loading ? (
              <>
                <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
                </svg>
                Calculando...
              </>
            ) : 'Calcular mejor tarifa'}
          </button>
        </form>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-red-700 text-sm mb-4">
          {error}
        </div>
      )}

      {results && (
        <div>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-lg font-semibold text-gray-800">
              Resultados — {results.weight_input} kg → {results.destination_resolved}
            </h2>
            <span className="text-xs text-gray-400">{results.results.length} agencia{results.results.length !== 1 ? 's' : ''}</span>
          </div>

          {results.results.length === 0 ? (
            <div className="bg-yellow-50 border border-yellow-200 rounded-lg px-4 py-4 text-yellow-800">
              Ninguna agencia cubre este destino con las tarifas actuales.
            </div>
          ) : (
            <div className="space-y-3">
              {results.results.map((r, i) => (
                <AgencyResult key={r.agency_name} {...r} isBest={i === 0} />
              ))}
            </div>
          )}

          {results.not_covered && results.not_covered.length > 0 && (
            <div className="mt-4 bg-gray-50 border border-gray-200 rounded-lg p-4">
              <p className="text-sm font-medium text-gray-600 mb-2">Agencias sin cobertura para este destino:</p>
              <ul className="text-sm text-gray-500 space-y-1">
                {results.not_covered.map((nc, i) => (
                  <li key={i} className="flex items-start gap-2">
                    <span className="text-gray-400 mt-0.5">·</span>
                    <span><strong>{nc.agency}</strong>: {nc.reason}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <p className="mt-4 text-xs text-gray-400 italic">
            Precios orientativos sin IVA. Confirmar con la agencia antes del envío.
          </p>
        </div>
      )}
    </div>
  );
}
