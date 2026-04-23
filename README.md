# Calculadora de Agencias de Envío — NATU Laboratories

Aplicación web para comparar tarifas de agencias de transporte (Redur, Transaher, Nacex).

## Requisitos

- Node.js >= 18.11
- npm >= 8

## Instalación

```bash
# Instalar todas las dependencias (raíz + server + client)
npm run install:all
```

## Configuración

Edita `server/.env` si necesitas cambiar la configuración por defecto:

```
PORT=3001
ADMIN_PASSWORD=NATU2026admin
DB_PATH=./database.sqlite
UPLOADS_PATH=./uploads
INITIAL_DATA_PATH=../data/initial
```

## Tarifas iniciales (opcional)

Coloca los archivos Excel en `data/initial/` para que se importen automáticamente al arrancar por primera vez (cuando la base de datos está vacía):

```
data/initial/
├── redur_2026.xlsx
├── redur_internacional_2026.xlsx
├── transaher_2026.xlsx
└── nacex_2026.xlsx
```

Si los archivos no están presentes, el servidor arranca igualmente con la base de datos vacía. Las tarifas se pueden subir después desde la sección **Admin**.

## Arranque

```bash
# Modo desarrollo (servidor + cliente en paralelo)
npm run dev
```

- Backend: http://localhost:3001
- Frontend: http://localhost:5173

## Uso

### Calculadora (`/`)
Introduce el peso y el código postal (nacional) o país (internacional) para obtener las tarifas de todas las agencias ordenadas de menor a mayor precio.

### Tarifas (`/tarifas`)
Consulta las tarifas completas por agencia y tipo de envío. Permite exportar a Excel.

### Admin (`/admin`)
Acceso protegido por contraseña (`NATU2026admin` por defecto). Permite subir nuevos archivos Excel para actualizar las tarifas de cualquier agencia.

## Estructura del proyecto

```
/
├── server/          — API Node.js + Express + SQLite
│   ├── index.js     — Entrada principal
│   ├── db.js        — Conexión y esquema SQLite
│   ├── routes/      — Endpoints REST
│   └── parsers/     — Parsers de Excel por agencia
├── client/          — Frontend React + Vite + Tailwind CSS
│   └── src/
│       ├── pages/   — Calculadora, Tarifas, Admin
│       └── components/
└── data/
    └── initial/     — Archivos Excel de tarifas iniciales
```

## Agencias soportadas

| Agencia   | Nacional | Internacional | Parser                            |
|-----------|----------|---------------|-----------------------------------|
| Redur     | ✓        | ✓             | redur_nacional / redur_internacional |
| Transaher | ✓        | ✓ (especial)  | transaher                         |
| Nacex     | ✓        | —             | nacex                             |
| Otras     | ✓        | —             | generic (requiere revisión)       |
