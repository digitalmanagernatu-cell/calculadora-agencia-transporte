import { useState, useEffect } from 'react';
import TariffTable from '../components/TariffTable';

export default function Tariffs() {
  const [agencies, setAgencies] = useState([]);
  const [selectedAgency, setSelectedAgency] = useState('');
  const [scope, setScope] = useState('nacional');
  const [tariffData, setTariffData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    fetch('/api/agencies')
      .then(r => r.json())
      .then(data => {
        setAgencies(data);
        if (data.length > 0) setSelectedAgency(String(data[0].id));
      })
      .catch(() => setError('Error al cargar las agencias'));
  }, []);

  useEffect(() => {
    if (!selectedAgency) return;
    setLoading(true);
    setError(null);
    fetch(`/api/tariffs?agency_id=${selectedAgency}&scope=${scope}`)
      .then(r => r.json())
      .then(data => setTariffData(data))
      .catch(() => setError('Error al cargar las tarifas'))
      .finally(() => setLoading(false));
  }, [selectedAgency, scope]);

  const selectedAgencyObj = agencies.find(a => String(a.id) === selectedAgency);

  function handleExport() {
    const url = `/api/tariffs/export?agency_id=${selectedAgency}&scope=${scope}`;
    const a = document.createElement('a');
    a.href = url;
    a.download = '';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Consulta de tarifas</h1>
        <p className="text-gray-500 mt-1">Visualiza las tarifas vigentes por agencia y tipo de envío</p>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-5 mb-6">
        <div className="flex flex-wrap gap-4 items-end">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Agencia</label>
            <select
              value={selectedAgency}
              onChange={e => setSelectedAgency(e.target.value)}
              className="border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-navy bg-white text-sm"
            >
              {agencies.map(a => (
                <option key={a.id} value={a.id}>{a.display_name}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Tipo de tarifa</label>
            <div className="flex gap-3">
              {[
                { value: 'nacional', label: 'Peninsular' },
                { value: 'internacional', label: 'Internacional' },
              ].map(opt => (
                <label key={opt.value} className="flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="radio"
                    name="scope"
                    value={opt.value}
                    checked={scope === opt.value}
                    onChange={() => setScope(opt.value)}
                    className="accent-navy"
                  />
                  <span className="text-sm text-gray-700">{opt.label}</span>
                </label>
              ))}
            </div>
          </div>

          {tariffData?.rates?.length > 0 && (
            <button
              onClick={handleExport}
              className="flex items-center gap-2 bg-gold text-white text-sm font-medium px-4 py-2 rounded-lg hover:bg-gold-light transition-colors"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
              </svg>
              Exportar a Excel
            </button>
          )}
        </div>

        {tariffData?.lastUpdated && (
          <p className="mt-3 text-xs text-gray-400">
            Última actualización: {new Date(tariffData.lastUpdated + 'Z').toLocaleString('es-ES')}
          </p>
        )}
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-red-700 text-sm mb-4">
          {error}
        </div>
      )}

      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-5">
        {loading ? (
          <div className="flex items-center justify-center py-12 text-gray-400">
            <svg className="animate-spin w-6 h-6 mr-2" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
            </svg>
            Cargando tarifas...
          </div>
        ) : (
          <TariffTable
            rates={tariffData?.rates || []}
            zoneMappings={tariffData?.zoneMappings || []}
            isPaletBased={tariffData?.isPaletBased || false}
          />
        )}
      </div>
    </div>
  );
}
