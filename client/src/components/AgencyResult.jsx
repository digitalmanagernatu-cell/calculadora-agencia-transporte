export default function AgencyResult({ agency_name, zone, price, scope, notes, zone_note, isBest }) {
  return (
    <div className={`p-4 rounded-lg border-2 transition-all ${
      isBest
        ? 'bg-green-50 border-green-400 shadow-md'
        : 'bg-white border-gray-200'
    }`}>
      <div className="flex justify-between items-start gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold text-lg text-gray-900">{agency_name}</span>
            {isBest && (
              <span className="inline-flex items-center bg-green-500 text-white text-xs font-bold px-2 py-0.5 rounded-full uppercase tracking-wide">
                Mejor precio
              </span>
            )}
          </div>
          <div className="mt-1 text-sm text-gray-500">
            <span className="font-medium text-gray-600">Zona:</span> {zone}
          </div>
          {notes && (
            <div className="mt-1 text-xs text-amber-700 bg-amber-50 rounded px-2 py-1 font-medium">{notes}</div>
          )}
          {zone_note && (
            <div className="mt-1 text-xs text-yellow-800 bg-yellow-50 border border-yellow-200 rounded px-2 py-1">{zone_note}</div>
          )}
        </div>
        <div className="text-right flex-shrink-0">
          <div className="text-2xl font-bold text-navy">
            {price !== null && price !== undefined ? price.toFixed(2) : '—'} €
          </div>
          <div className="text-xs text-gray-400 mt-0.5">sin IVA</div>
        </div>
      </div>
    </div>
  );
}
