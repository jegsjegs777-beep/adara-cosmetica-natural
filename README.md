# ADARA Cosmética Natural

Catálogo web (PWA) y panel administrativo para ADARA Cosmética Natural — una marca salvadoreña de cosmética natural artesanal. Los pedidos se arman en el sitio y se envían por WhatsApp; no hay pagos procesados dentro de la app.

## Estructura del proyecto

```
adara-pwa/
├── index.html          # Sitio de clientes (catálogo, pedidos, cuenta mayorista)
├── css/styles.css       # Estilos del sitio de clientes
├── js/
│   ├── app.js            # Lógica del sitio de clientes
│   ├── data.js            # Catálogo de productos (temporal, hasta conectar Supabase)
│   └── icons.js           # Set de íconos SVG propios (sin dependencias externas)
├── manifest.json         # Configuración de instalación como PWA
├── sw.js                  # Service worker (funcionamiento offline básico)
├── icons/                  # Favicon, íconos de instalación y logo de marca
├── admin/
│   ├── index.html           # Panel administrativo (productos, ventas, mayoristas)
│   ├── css/admin.css
│   └── js/admin.js
└── database/
    └── schema.sql            # Esquema completo para Supabase (PostgreSQL)
```

## Estado actual

El sitio y el panel funcionan en **modo demostración** (datos de ejemplo en memoria, sin base de datos real todavía). Para pasar a producción falta:

1. Crear el proyecto en [Supabase](https://supabase.com) y ejecutar `database/schema.sql`
2. Completar `CONFIG.SUPABASE_URL` y `CONFIG.SUPABASE_ANON_KEY` en `js/app.js` y en `admin/js/admin.js`
3. Completar los pendientes marcados como `TODO` en `js/app.js` (número de WhatsApp, número del administrador, dirección/tarifas de envío)
4. Reemplazar el catálogo de ejemplo en `js/data.js` por el catálogo completo (idealmente ya migrado a Supabase y administrado desde el panel)
5. Configurar Supabase Storage para que la subida de fotos de producto en el panel admin guarde archivos reales

## Cómo verlo localmente

No requiere instalación ni build. Basta con abrir `index.html` (o `admin/index.html`) directamente en el navegador, manteniendo la carpeta completa junto a él (no mover el archivo solo).

## Publicarlo con GitHub Pages

1. Sube esta carpeta completa a un repositorio de GitHub
2. En el repositorio → **Settings → Pages** → en "Source" elige la rama principal (`main`) y la carpeta raíz (`/`)
3. Guarda — GitHub te da una URL temporal tipo `tuusuario.github.io/nombre-repo`
4. Cuando tengas el dominio registrado (`adaracosmeticanatural.com`):
   - Agrega en tu proveedor de dominio los registros DNS que pide GitHub (4 registros A + 1 CNAME para `www`)
   - En **Settings → Pages → Custom domain**, escribe `www.adaracosmeticanatural.com` (el archivo `CNAME` de este repo ya trae este valor precargado)
   - Activa **Enforce HTTPS** una vez el dominio esté verificado

El sitio de clientes queda en la raíz del dominio; el panel admin queda en `/admin/` — no está enlazado desde el sitio público, así que conviene no compartir esa dirección hasta que el panel tenga login real (Supabase Auth) protegiéndolo.

## Notas técnicas

- Sin frameworks ni paso de build: HTML, CSS y JavaScript plano
- Librerías externas cargadas por CDN en tiempo de ejecución: Supabase JS, jsPDF (reportes de ventas)
- Diseñado mobile-first; el panel admin es desktop-first
