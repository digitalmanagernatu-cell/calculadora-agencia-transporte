import { useState } from 'react';

// Canonical display order for Palemanía service types (mirrors PALEMANIA_COLUMNS in the parser)
const PALET_ROW_ORDER = [
  { palet_type: 'MQ',               max_kg_per_palet: 75,   num_pales: 1 },
  { palet_type: 'Quarter',          max_kg_per_palet: 150,  num_pales: 1 },
  { palet_type: 'Super Euro Light', max_kg_per_palet: 200,  num_pales: 1 },
  { palet_type: 'Super Euro Light', max_kg_per_palet: 200,  num_pales: 2 },
  { palet_type: 'Super Euro Light', max_kg_per_palet: 200,  num_pales: 3 },
  { palet_type: 'Half',             max_kg_per_palet: 250,  num_pales: 1 },
  { palet_type: 'Extra Light',      max_kg_per_palet: 300,  num_pales: 1 },
  { palet_type: 'Extra Light',      max_kg_per_palet: 300,  num_pales: 2 },
  { palet_type: 'Extra Light',      max_kg_per_palet: 300,  num_pales: 3 },
  { palet_type: 'Euro',             max_kg_per_palet: 500,  num_pales: 1 },
  { palet_type: 'Euro',             max_kg_per_palet: 500,  num_pales: 2 },
  { palet_type: 'Euro',             max_kg_per_palet: 500,  num_pales: 3 },
  { palet_type: 'Euro',             max_kg_per_palet: 500,  num_pales: 4 },
  { palet_type: 'Euro',             max_kg_per_palet: 500,  num_pales: 5 },
  { palet_type: 'Full',             max_kg_per_palet: 1000, num_pales: 1 },
  { palet_type: 'Full',             max_kg_per_palet: 1000, num_pales: 2 },
  { palet_type: 'Full',             max_kg_per_palet: 1000, num_pales: 3 },
  { palet_type: 'Full',             max_kg_per_palet: 1000, num_pales: 4 },
  { palet_type: 'Full',             max_kg_per_palet: 1000, num_pales: 5 },
];

function rowKey(r) {
  return `${r.palet_type}|${r.max_kg_per_palet}|${r.num_pales}`;
}

function sortZones(zones) {
  return [...zones].sort((a, b) => parseFloat(a) - parseFloat(b));
}

function PaletTable({ rates, zoneMappings }) {
  const [showMappings, setShowMappings] = useState(false);

  if (!rates || rates.length === 0) {
    return <div className="text-center text-gray-500 py-8">No hay tarifas disponibles para la selección actual.</div>;
  }

  const zones = sortZones([...new Set(rates.map(r => r.zone))]);

  // lookup: rowKey → zone → rate
  const lookup = {};
  for (const r of rates) {
    const k = rowKey(r);
    if (!lookup[k]) lookup[k] = {};
    lookup[k][r.zone] = r;
  }

  // Only show rows that have at least one price in the data
  const rows = PALET_ROW_ORDER.filter(def => lookup[rowKey(def)]);

  const mappingsByZone = {};
  if (zoneMappings) {
    for (const m of zoneMappings) {
      if (!mappingsByZone[m.zone]) mappingsByZone[m.zone] = [];
      mappingsByZone[m.zone].push(m.destination);
    }
  }

  return (
    <div>
      <div className="overflow-x-auto">
        <table className="min-w-full text-sm border-collapse">
          <thead>
            <tr className="bg-navy text-white">
              <th className="px-3 py-2 text-left font-medium sticky left-0 bg-navy whitespace-nowrap">Servicio</th>
              <th className="px-3 py-2 text-left font-medium sticky bg-navy whitespace-nowrap">Capacidad</th>
              {zones.map(z => (
                <th key={z} className="px-3 py-2 text-center font-medium whitespace-nowrap">Zona {z}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((def, idx) => {
              const k = rowKey(def);
              const capacity = def.max_kg_per_palet * def.num_pales;
              return (
                <tr key={k} className={idx % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                  <td className="px-3 py-2 font-medium text-gray-700 sticky left-0 bg-inherit border-r border-gray-200 whitespace-nowrap">
                    {def.num_pales > 1 ? `${def.num_pales}× ` : ''}{def.palet_type}
                  </td>
                  <td className="px-3 py-2 text-gray-500 whitespace-nowrap border-r border-gray-100">
                    máx. {capacity} kg
                  </td>
                  {zones.map(z => {
                    const rate = lookup[k]?.[z];
                    const total = rate ? rate.price_per_palet * rate.num_pales : null;
                    return (
                      <td key={z} className="px-3 py-2 text-center text-gray-800">
                        {total != null ? (
                          <span>{total.toFixed(2)} €</span>
                        ) : (
                          <span className="text-gray-300">—</span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {zoneMappings && zoneMappings.length > 0 && (
        <div className="mt-4">
          <button
            onClick={() => setShowMappings(v => !v)}
            className="flex items-center gap-2 text-sm font-medium text-navy hover:text-navy-light transition-colors"
          >
            <svg className={`w-4 h-4 transition-transform ${showMappings ? 'rotate-90' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
            {showMappings ? 'Ocultar' : 'Ver'} tabla de zonas / destinos
          </button>
          {showMappings && (
            <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {Object.entries(mappingsByZone).sort(([a], [b]) => parseFloat(a) - parseFloat(b)).map(([zone, destinations]) => (
                <div key={zone} className="bg-gray-50 rounded-lg p-3 border border-gray-200">
                  <div className="font-semibold text-navy text-sm mb-1">Zona {zone}</div>
                  <div className="text-xs text-gray-600 leading-relaxed">{destinations.join(', ')}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function TariffTable({ rates, zoneMappings, isPaletBased }) {
  const [showMappings, setShowMappings] = useState(false);

  if (isPaletBased) {
    return <PaletTable rates={rates} zoneMappings={zoneMappings} />;
  }

  if (!rates || rates.length === 0) {
    return (
      <div className="text-center text-gray-500 py-8">
        No hay tarifas disponibles para la selección actual.
      </div>
    );
  }

  // Build zone × weight matrix
  const zones = [...new Set(rates.map(r => r.zone))].sort();
  const weights = [...new Set(rates.map(r => r.weight_max_kg))].sort((a, b) => a - b);

  // Create lookup: zone → weight → rate
  const lookup = {};
  for (const r of rates) {
    if (!lookup[r.zone]) lookup[r.zone] = {};
    lookup[r.zone][r.weight_max_kg] = r;
  }

  // Group zone mappings by zone
  const mappingsByZone = {};
  if (zoneMappings) {
    for (const m of zoneMappings) {
      if (!mappingsByZone[m.zone]) mappingsByZone[m.zone] = [];
      mappingsByZone[m.zone].push(m.destination);
    }
  }

  return (
    <div>
      {/* Rate matrix table */}
      <div className="overflow-x-auto">
        <table className="min-w-full text-sm border-collapse">
          <thead>
            <tr className="bg-navy text-white">
              <th className="px-3 py-2 text-left font-medium sticky left-0 bg-navy">Peso máx (kg)</th>
              {zones.map(z => (
                <th key={z} className="px-3 py-2 text-center font-medium whitespace-nowrap">{z}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {weights.map((w, idx) => (
              <tr key={w} className={idx % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                <td className="px-3 py-2 font-medium text-gray-700 sticky left-0 bg-inherit border-r border-gray-200">
                  {w} kg
                </td>
                {zones.map(z => {
                  const rate = lookup[z]?.[w];
                  return (
                    <td key={z} className="px-3 py-2 text-center text-gray-800">
                      {rate ? (
                        <span>{rate.price.toFixed(2)} €</span>
                      ) : (
                        <span className="text-gray-300">—</span>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
            {/* Extra per kg row */}
            <tr className="bg-amber-50 border-t-2 border-amber-200">
              <td className="px-3 py-2 font-medium text-amber-800 sticky left-0 bg-amber-50 border-r border-amber-200">
                + €/kg extra
              </td>
              {zones.map(z => {
                const lastRate = rates.filter(r => r.zone === z).sort((a, b) => b.weight_max_kg - a.weight_max_kg)[0];
                return (
                  <td key={z} className="px-3 py-2 text-center text-amber-700">
                    {lastRate?.extra_per_kg != null
                      ? `${lastRate.extra_per_kg.toFixed(3)} €/kg`
                      : <span className="text-gray-300">—</span>}
                  </td>
                );
              })}
            </tr>
          </tbody>
        </table>
      </div>

      {/* Zone mappings collapsible */}
      {zoneMappings && zoneMappings.length > 0 && (
        <div className="mt-4">
          <button
            onClick={() => setShowMappings(v => !v)}
            className="flex items-center gap-2 text-sm font-medium text-navy hover:text-navy-light transition-colors"
          >
            <svg className={`w-4 h-4 transition-transform ${showMappings ? 'rotate-90' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
            {showMappings ? 'Ocultar' : 'Ver'} tabla de zonas / destinos
          </button>
          {showMappings && (
            <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {Object.entries(mappingsByZone).map(([zone, destinations]) => (
                <div key={zone} className="bg-gray-50 rounded-lg p-3 border border-gray-200">
                  <div className="font-semibold text-navy text-sm mb-1">{zone}</div>
                  <div className="text-xs text-gray-600 leading-relaxed">
                    {destinations.join(', ')}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
