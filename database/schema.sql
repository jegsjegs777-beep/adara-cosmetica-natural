-- ============================================================================
-- ADARA COSMÉTICA NATURAL — ESQUEMA DE BASE DE DATOS (Supabase / PostgreSQL)
-- ============================================================================
-- Diseño relacional normalizado: catálogo por variantes con interruptor de
-- disponibilidad, pedidos con trazabilidad completa, registro simple de
-- ventas mensuales, aprobación de cuentas mayoristas, zonas de envío y
-- comprobantes de pago.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- EXTENSIONES
-- ---------------------------------------------------------------------------
create extension if not exists "pgcrypto"; -- para gen_random_uuid()

-- ---------------------------------------------------------------------------
-- CATEGORÍAS
-- ---------------------------------------------------------------------------
create table categorias (
  id            uuid primary key default gen_random_uuid(),
  nombre        text not null,
  slug          text not null unique,          -- ej. 'cabello', 'rostro'
  icono         text,                           -- nombre de ícono (tabler-icons)
  orden         integer default 0,              -- para controlar el orden de despliegue
  creado_en     timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- PRODUCTOS
-- ---------------------------------------------------------------------------
create table productos (
  id            uuid primary key default gen_random_uuid(),
  categoria_id  uuid not null references categorias(id) on delete restrict,
  nombre        text not null,
  descripcion   text,
  color_hex     text,                           -- color de referencia visual (mientras no hay fotos)
  imagen_url    text,                           -- URL de la foto real cuando esté disponible
  etiqueta      text,                           -- ej. 'kit ahorro', 'duo', 'anticaspa'
  activo        boolean not null default true,  -- permite ocultar sin borrar
  creado_en     timestamptz not null default now(),
  actualizado_en timestamptz not null default now()
);

create index idx_productos_categoria on productos(categoria_id);
create index idx_productos_activo on productos(activo);

-- ---------------------------------------------------------------------------
-- VARIANTES DE PRODUCTO (tamaño / presentación / kit)
-- Cada producto puede tener una o varias presentaciones, cada una con su
-- propio precio, precio mayorista, SKU y stock — igual que en un sistema
-- de inventario por referencia.
-- ---------------------------------------------------------------------------
create table variantes_producto (
  id                uuid primary key default gen_random_uuid(),
  producto_id       uuid not null references productos(id) on delete cascade,
  etiqueta          text not null,              -- ej. '500ml', 'Kit 250ml', '125gr'
  sku               text unique,                -- código interno único
  precio_detalle    numeric(10,2) not null check (precio_detalle >= 0),
  precio_mayorista  numeric(10,2) check (precio_mayorista >= 0),
  disponible        boolean not null default true, -- interruptor simple: se puede pedir ahora mismo
  stock             integer,                    -- reservado para cuando decidan llevar conteo exacto (no se usa por ahora)
  stock_minimo      integer default 5,          -- idem — umbral de reabastecimiento, uso futuro
  activo            boolean not null default true,
  creado_en         timestamptz not null default now()
);

create index idx_variantes_producto on variantes_producto(producto_id);

-- ---------------------------------------------------------------------------
-- CLIENTES
-- ---------------------------------------------------------------------------
create type tipo_cliente as enum ('detalle', 'mayorista');

create table clientes (
  id            uuid primary key default gen_random_uuid(),
  auth_user_id  uuid unique,                    -- vínculo con Supabase Auth
  nombre        text not null,
  telefono      text not null,
  correo        text,
  tipo          tipo_cliente not null default 'detalle', -- se pone 'mayorista' automáticamente al registrarse desde el formulario mayorista
  creado_en     timestamptz not null default now()
);

create index idx_clientes_telefono on clientes(telefono);

-- ---------------------------------------------------------------------------
-- SOLICITUDES DE CUENTA MAYORISTA
-- Nota de negocio: la cuenta y el acceso a la app son inmediatos (el cliente
-- puede registrarse, iniciar sesión y navegar el catálogo sin esperar nada).
-- Lo único que queda bloqueado hasta la aprobación del admin es el PRECIO
-- mayorista: mientras la solicitud esté en 'pendiente', ve precios de
-- detalle igual que cualquier cliente. Al aprobarla desde el panel, el
-- trigger de abajo actualiza clientes.tipo a 'mayorista' automáticamente
-- y desde ese momento el precio mayorista se muestra.
-- ---------------------------------------------------------------------------
create type estado_solicitud as enum ('pendiente', 'aprobado', 'rechazado');

create table solicitudes_mayorista (
  id                uuid primary key default gen_random_uuid(),
  cliente_id        uuid not null references clientes(id) on delete cascade,
  nombre_negocio    text,
  estado            estado_solicitud not null default 'pendiente',
  revisado_por      text,                       -- nombre/usuario del admin que revisó
  revisado_en       timestamptz,
  notas             text,
  creado_en         timestamptz not null default now()
);

create index idx_solicitudes_cliente on solicitudes_mayorista(cliente_id);

-- Al aprobar la solicitud desde el panel admin, el cliente pasa a 'mayorista'
-- automáticamente y empieza a ver precio mayorista.
create or replace function aprobar_mayorista()
returns trigger as $$
begin
  if new.estado = 'aprobado' and (old.estado is distinct from 'aprobado') then
    update clientes set tipo = 'mayorista' where id = new.cliente_id;
  elsif new.estado = 'rechazado' and (old.estado is distinct from 'rechazado') then
    update clientes set tipo = 'detalle' where id = new.cliente_id;
  end if;
  return new;
end;
$$ language plpgsql;

create trigger trg_aprobar_mayorista
  after update on solicitudes_mayorista
  for each row
  execute function aprobar_mayorista();

create index idx_solicitudes_estado on solicitudes_mayorista(estado);

-- ---------------------------------------------------------------------------
-- ZONAS DE ENVÍO
-- ---------------------------------------------------------------------------
create table zonas_envio (
  id                uuid primary key default gen_random_uuid(),
  nombre_zona       text not null,
  departamento      text,
  tarifa            numeric(10,2) not null default 0,
  es_gratis         boolean not null default false,
  tiempo_estimado   text,                       -- ej. '1-2 días hábiles'
  activo            boolean not null default true
);

-- ---------------------------------------------------------------------------
-- PUNTOS DE VENTA (retiro en tienda)
-- ---------------------------------------------------------------------------
create table puntos_venta (
  id            uuid primary key default gen_random_uuid(),
  nombre        text not null,
  direccion     text not null,
  referencia    text,
  telefono      text,
  activo        boolean not null default true
);

-- ---------------------------------------------------------------------------
-- PEDIDOS
-- ---------------------------------------------------------------------------
create type metodo_entrega as enum ('domicilio', 'tienda');
create type metodo_pago as enum ('contra_entrega_efectivo', 'contra_entrega_transferencia', 'transferencia_anticipo');
create type estado_pago as enum ('pendiente', 'anticipo_confirmado', 'pagado', 'rechazado');
create type estado_pedido as enum ('recibido', 'en_preparacion', 'enviado', 'entregado', 'cancelado');

create table pedidos (
  id                uuid primary key default gen_random_uuid(),
  numero_pedido     text not null unique,       -- ej. 'A-0142', generado por trigger/secuencia
  cliente_id        uuid not null references clientes(id) on delete restrict,
  tipo_cliente      tipo_cliente not null,       -- copiado al momento del pedido (histórico, no cambia si el cliente cambia de tipo después)

  metodo_entrega    metodo_entrega not null,
  zona_envio_id     uuid references zonas_envio(id),
  punto_venta_id    uuid references puntos_venta(id),
  direccion_entrega text,                        -- referencia/dirección escrita por el cliente

  metodo_pago       metodo_pago not null,
  estado_pago       estado_pago not null default 'pendiente',

  subtotal          numeric(10,2) not null check (subtotal >= 0),
  costo_envio       numeric(10,2) default 0,
  anticipo          numeric(10,2) default 0,     -- solo aplica a mayoristas (50%)
  saldo_pendiente   numeric(10,2) default 0,

  estado_pedido     estado_pedido not null default 'recibido',
  gestor_asignado   text,                        -- nombre del vendedor/gestor que da seguimiento

  creado_en         timestamptz not null default now(),
  actualizado_en    timestamptz not null default now()
);

create index idx_pedidos_cliente on pedidos(cliente_id);
create index idx_pedidos_estado on pedidos(estado_pedido);
create index idx_pedidos_fecha on pedidos(creado_en);

-- Secuencia + función para generar el número de pedido automáticamente (A-0001, A-0002...)
create sequence pedido_numero_seq start 1;

create or replace function generar_numero_pedido()
returns trigger as $$
begin
  new.numero_pedido := 'A-' || lpad(nextval('pedido_numero_seq')::text, 4, '0');
  return new;
end;
$$ language plpgsql;

create trigger trg_numero_pedido
  before insert on pedidos
  for each row
  when (new.numero_pedido is null)
  execute function generar_numero_pedido();

-- ---------------------------------------------------------------------------
-- DETALLE DE PEDIDO (líneas de producto por pedido)
-- ---------------------------------------------------------------------------
create table detalle_pedido (
  id                uuid primary key default gen_random_uuid(),
  pedido_id         uuid not null references pedidos(id) on delete cascade,
  variante_id       uuid not null references variantes_producto(id) on delete restrict,
  cantidad          integer not null check (cantidad > 0),
  precio_unitario   numeric(10,2) not null,      -- se guarda el precio al momento de comprar (no cambia si el precio cambia después)
  subtotal_linea    numeric(10,2) generated always as (cantidad * precio_unitario) stored
);

create index idx_detalle_pedido on detalle_pedido(pedido_id);

-- ---------------------------------------------------------------------------
-- COMPROBANTES DE PAGO (capturas de transferencia)
-- ---------------------------------------------------------------------------
create table comprobantes_pago (
  id            uuid primary key default gen_random_uuid(),
  pedido_id     uuid not null references pedidos(id) on delete cascade,
  imagen_url    text not null,                  -- guardada en Supabase Storage
  subido_en     timestamptz not null default now(),
  verificado    boolean default false
);

-- ---------------------------------------------------------------------------
-- VENTAS MANUALES — registro simple para llevar control de cuánto se ha
-- vendido en el mes, sin depender de un conteo exacto de inventario.
-- Se registra desde el panel admin con el botón "Vender".
-- ---------------------------------------------------------------------------
create table ventas_manuales (
  id                uuid primary key default gen_random_uuid(),
  variante_id       uuid not null references variantes_producto(id) on delete restrict,
  cantidad          integer not null default 1 check (cantidad > 0),
  precio_unitario   numeric(10,2) not null,
  subtotal          numeric(10,2) generated always as (cantidad * precio_unitario) stored,
  canal             text default 'mostrador',   -- ej. mostrador, feria, redes sociales
  registrado_por    text,                       -- quién lo registró (admin)
  vendido_en        timestamptz not null default now()
);

create index idx_ventas_manuales_fecha on ventas_manuales(vendido_en);

-- ---------------------------------------------------------------------------
-- TRIGGER: descontar stock automáticamente al confirmar un pedido
-- NOTA: como no llevan conteo exacto de inventario por ahora, este trigger
-- queda desactivado (comentado). El campo `stock` se mantiene en la tabla
-- por si en el futuro deciden activarlo — en ese caso, solo hay que quitar
-- los comentarios de abajo.
-- ---------------------------------------------------------------------------
-- create or replace function descontar_stock()
-- returns trigger as $$
-- begin
--   update variantes_producto
--   set stock = stock - new.cantidad
--   where id = new.variante_id;
--   return new;
-- end;
-- $$ language plpgsql;
--
-- create trigger trg_descontar_stock
--   after insert on detalle_pedido
--   for each row
--   execute function descontar_stock();

-- ---------------------------------------------------------------------------
-- SEGURIDAD (Row Level Security) — esqueleto base
-- Los mayoristas solo deben ver precio_mayorista si su solicitud fue aprobada.
-- El panel admin (rol de servicio) tiene acceso completo sin restricciones.
-- ---------------------------------------------------------------------------
alter table variantes_producto enable row level security;
alter table pedidos enable row level security;
alter table solicitudes_mayorista enable row level security;

-- (Las políticas específicas de RLS se definen al conectar Supabase Auth
--  con el flujo de aprobación de mayoristas — pendiente para la fase de
--  implementación del panel admin.)
