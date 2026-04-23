import { BrowserRouter, Routes, Route, NavLink } from 'react-router-dom';
import Calculator from './pages/Calculator';
import Tariffs from './pages/Tariffs';
import Upload from './pages/Upload';

export default function App() {
  return (
    <BrowserRouter>
      <div className="min-h-screen bg-gray-100">
        {/* Header */}
        <header className="bg-navy shadow-md">
          <div className="max-w-6xl mx-auto px-4 sm:px-6 flex items-center justify-between h-14">
            <div className="flex items-center gap-3">
              <span className="text-gold font-bold text-xl tracking-wide">NATU</span>
              <span className="text-white/40 font-light">|</span>
              <span className="text-white/80 font-medium text-sm">Calculadora de Envíos</span>
            </div>
            <nav className="flex gap-1">
              {[
                { to: '/', label: 'Calculadora' },
                { to: '/tarifas', label: 'Tarifas' },
                { to: '/admin', label: 'Admin' },
              ].map(({ to, label }) => (
                <NavLink
                  key={to}
                  to={to}
                  end={to === '/'}
                  className={({ isActive }) =>
                    `px-3 py-1.5 rounded text-sm font-medium transition-colors ${
                      isActive
                        ? 'bg-white/15 text-white'
                        : 'text-white/60 hover:text-white hover:bg-white/10'
                    }`
                  }
                >
                  {label}
                </NavLink>
              ))}
            </nav>
          </div>
        </header>

        {/* Main content */}
        <main className="max-w-6xl mx-auto px-4 sm:px-6 py-8">
          <Routes>
            <Route path="/" element={<Calculator />} />
            <Route path="/tarifas" element={<Tariffs />} />
            <Route path="/admin" element={<Upload />} />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  );
}
