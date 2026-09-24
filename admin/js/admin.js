// ==========================================================================
// ADARA — Panel administrativo
// ==========================================================================
// Este panel funciona en dos modos:
//   • DEMO  → mientras CONFIG.SUPABASE_URL/KEY estén vacíos, usa datos en
//             memoria (una copia editable del catálogo actual) para que
//             puedas explorar y probar el panel sin tener Supabase todavía.
//   • LIVE  → una vez completes CONFIG con tu proyecto real de Supabase,
//             todas las funciones de abajo (marcadas "Supabase real") pasan
//             a leer y escribir directamente en las tablas del esquema
//             (ver database/schema.sql).
// ==========================================================================

const CONFIG = {
  SUPABASE_URL: "https://blkssnpdiyjsashxomiu.supabase.co", // conectado ✅
  SUPABASE_ANON_KEY: "sb_publishable_QW0Oq9uAK-UVaTJhUWRk5A_yW3-r31e", // conectado ✅
};

const isLiveMode = Boolean(CONFIG.SUPABASE_URL && CONFIG.SUPABASE_ANON_KEY);
let supabaseClient = null;
if (isLiveMode && window.supabase) {
  supabaseClient = window.supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY);
}

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);
const money = (n) => `$${Number(n || 0).toFixed(2)}`;

// ==========================================================================
// DEMO STORE — copia editable en memoria construida a partir de data.js
// ==========================================================================
let demoProducts = PRODUCTS.map((p) => ({
  id: p.id,
  name: p.name,
  category: p.category,
  tag: p.tag || "",
  color: p.color,
  description: p.description,
  active: true,
  variants: p.variants.map((v, i) => ({
    id: `${p.id}-v${i}`,
    label: v.label,
    sku: "",
    retailPrice: v.price,
    wholesalePrice: v.wholesalePrice,
    available: true,
  })),
}));

let demoSales = []; // { id, variantId, productName, variantLabel, quantity, unitPrice, soldAt }

let demoWholesaleApps = [
  { id: "w1", businessName: "Distribuidora Bella Piel", customerName: "Karla Hernández", phone: "7222-1190", email: "karla@bellapiel.com", status: "pendiente", createdAt: "2026-09-10" },
  { id: "w2", businessName: "Salón Aura", customerName: "Roxana Meléndez", phone: "7011-4482", email: "roxana@salonaura.com", status: "aprobado", createdAt: "2026-09-05" },
  { id: "w3", businessName: "Spa Natural SV", customerName: "Diego Flores", phone: "7899-0033", email: "diego@sparnatural.sv", status: "pendiente", createdAt: "2026-09-14" },
];

// ==========================================================================
// CAPA DE DATOS — abstrae demo vs Supabase real
// ==========================================================================

// Convierte una fila de Supabase (con sus joins) a la misma forma que usa
// el resto del panel, para no tener que duplicar la lógica de renderizado.
function normalizeProduct(row) {
  return {
    id: row.id,
    name: row.nombre,
    category: row.categorias ? row.categorias.slug : null,
    tag: row.etiqueta || "",
    color: row.color_hex || "#e8e3d6",
    description: row.descripcion || "",
    imageUrl: row.imagen_url || null,
    active: row.activo,
    variants: (row.variantes_producto || []).map((v) => ({
      id: v.id,
      label: v.etiqueta,
      sku: v.sku || "",
      retailPrice: Number(v.precio_detalle),
      wholesalePrice: v.precio_mayorista != null ? Number(v.precio_mayorista) : null,
      available: v.disponible !== false,
    })),
  };
}

let categoriesCache = []; // {id (slug), label, icon, dbId (uuid, solo en modo live)}

async function getCategories() {
  if (isLiveMode) {
    const { data, error } = await supabaseClient.from("categorias").select("*").order("orden");
    if (error) throw error;
    categoriesCache = data.map((c) => ({ id: c.slug, label: c.nombre, icon: c.icono, dbId: c.id }));
    return categoriesCache;
  }
  categoriesCache = CATEGORIES.filter((c) => c.id !== "todos");
  return categoriesCache;
}

async function getProducts() {
  if (isLiveMode) {
    // --- Supabase real ---
    const { data, error } = await supabaseClient
      .from("productos")
      .select("*, categorias(nombre,slug), variantes_producto(*)")
      .order("nombre");
    if (error) throw error;
    return data.map(normalizeProduct);
  }
  return demoProducts;
}

// Sube una foto (dataURL) a Supabase Storage y devuelve la URL pública.
// Si el valor ya es una URL (no una foto nueva), la deja tal cual.
async function uploadProductPhotoIfNeeded(imageUrl, productId) {
  if (!imageUrl || !imageUrl.startsWith("data:")) return imageUrl || null;

  const matches = imageUrl.match(/^data:(image\/\w+);base64,(.+)$/);
  if (!matches) return null;
  const mime = matches[1];
  const ext = mime.split("/")[1] || "jpg";
  const binary = atob(matches[2]);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const blob = new Blob([bytes], { type: mime });

  const filePath = `${productId}-${Date.now()}.${ext}`;
  const { error: uploadError } = await supabaseClient
    .storage.from("productos")
    .upload(filePath, blob, { contentType: mime, upsert: true });
  if (uploadError) throw uploadError;

  const { data } = supabaseClient.storage.from("productos").getPublicUrl(filePath);
  return data.publicUrl;
}

async function saveProduct(product) {
  if (isLiveMode) {
    // --- Supabase real ---
    if (!categoriesCache.length) await getCategories();
    const categoria = categoriesCache.find((c) => c.id === product.category);
    if (!categoria) throw new Error("Categoría no encontrada. Recarga la página e intenta de nuevo.");

    const isNew = !product.id || String(product.id).startsWith("p-");

    // 1) producto (crear o actualizar)
    const photoUrl = await uploadProductPhotoIfNeeded(product.imageUrl, isNew ? `nuevo-${Date.now()}` : product.id);

    const productoRow = {
      nombre: product.name,
      categoria_id: categoria.dbId,
      descripcion: product.description,
      color_hex: product.color,
      imagen_url: photoUrl,
      etiqueta: product.tag || null,
      activo: product.active,
    };

    let productoId = product.id;
    if (isNew) {
      const { data, error } = await supabaseClient.from("productos").insert(productoRow).select().single();
      if (error) throw error;
      productoId = data.id;
    } else {
      const { error } = await supabaseClient.from("productos").update(productoRow).eq("id", productoId);
      if (error) throw error;
    }

    // 2) variantes — se reemplazan todas (simple y confiable mientras el
    //    catálogo no tiene pedidos reales asociados; si una variante ya
    //    tiene pedidos, Supabase rechazará su eliminación y avisará aquí).
    if (!isNew) {
      const { error: delError } = await supabaseClient.from("variantes_producto").delete().eq("producto_id", productoId);
      if (delError) {
        throw new Error("No se pudieron actualizar las variantes: " + delError.message + " (probablemente alguna ya tiene pedidos asociados).");
      }
    }

    const variantRows = product.variants.map((v) => ({
      producto_id: productoId,
      etiqueta: v.label,
      sku: v.sku || null,
      precio_detalle: v.retailPrice,
      precio_mayorista: v.wholesalePrice,
      disponible: v.available !== false,
    }));
    const { error: varError } = await supabaseClient.from("variantes_producto").insert(variantRows);
    if (varError) throw varError;

    return;
  }
  const idx = demoProducts.findIndex((p) => p.id === product.id);
  if (idx === -1) {
    demoProducts.push(product);
  } else {
    demoProducts[idx] = product;
  }
}

async function deleteProduct(id) {
  if (isLiveMode) {
    const { error } = await supabaseClient.from("productos").delete().eq("id", id);
    if (error) throw error;
    return;
  }
  demoProducts = demoProducts.filter((p) => p.id !== id);
}

async function getWholesaleApps() {
  if (isLiveMode) {
    const { data, error } = await supabaseClient
      .from("solicitudes_mayorista")
      .select("*, clientes(nombre,telefono,correo)")
      .order("creado_en", { ascending: false });
    if (error) throw error;
    return data;
  }
  return demoWholesaleApps;
}

async function updateWholesaleStatus(id, status) {
  if (isLiveMode) {
    const { error } = await supabaseClient
      .from("solicitudes_mayorista")
      .update({ estado: status, revisado_en: new Date().toISOString() })
      .eq("id", id);
    if (error) throw error;
    return;
  }
  const app = demoWholesaleApps.find((a) => a.id === id);
  if (app) app.status = status;
}

async function deleteWholesaleAccount(id) {
  if (isLiveMode) {
    // Elimina la solicitud; el trigger de aprobación no aplica a un registro
    // borrado, así que el cliente vuelve a ver precio de detalle. Si además
    // quieres borrar la cuenta de Supabase Auth, hazlo desde Authentication
    // en el panel de Supabase (por seguridad, no se hace desde aquí).
    const { error } = await supabaseClient.from("solicitudes_mayorista").delete().eq("id", id);
    if (error) throw error;
    return;
  }
  demoWholesaleApps = demoWholesaleApps.filter((a) => a.id !== id);
}

// ==========================================================================
// LOGIN
// ==========================================================================
function setupLogin() {
  if (!isLiveMode) {
    $("#login-config-notice").classList.remove("hidden");
  }

  $("#btn-demo-mode").addEventListener("click", () => {
    enterAdmin(true);
  });

  $("#btn-login").addEventListener("click", async () => {
    const email = $("#login-email").value.trim();
    const password = $("#login-password").value;
    const errorBox = $("#login-error");
    errorBox.classList.add("hidden");

    if (!isLiveMode) {
      errorBox.textContent = "Supabase no está conectado todavía. Usa el modo demostración por ahora.";
      errorBox.classList.remove("hidden");
      return;
    }

    const { error } = await supabaseClient.auth.signInWithPassword({ email, password });
    if (error) {
      errorBox.textContent = "Correo o contraseña incorrectos.";
      errorBox.classList.remove("hidden");
      return;
    }
    enterAdmin(false);
  });
}

function enterAdmin(demo) {
  $("#login-screen").classList.add("hidden");
  $("#admin-app").style.display = "flex";
  if (demo) $("#demo-banner").classList.remove("hidden");
  loadProductsPage();
  loadWholesalePage();
  loadSalesPage();
}

// ==========================================================================
// NAVEGACIÓN LATERAL
// ==========================================================================
function setupSidebar() {
  $$(".nav-link").forEach((link) => {
    link.addEventListener("click", () => {
      $$(".nav-link").forEach((l) => l.classList.remove("active"));
      link.classList.add("active");
      $$(".page").forEach((p) => p.classList.add("hidden"));
      $(`#page-${link.dataset.page}`).classList.remove("hidden");
    });
  });

  $("#btn-logout").addEventListener("click", async () => {
    if (isLiveMode && supabaseClient) await supabaseClient.auth.signOut();
    $("#admin-app").style.display = "none";
    $("#login-screen").classList.remove("hidden");
  });
}

// ==========================================================================
// PÁGINA: PRODUCTOS
// ==========================================================================
async function populateCategoryFilters() {
  const categories = await getCategories();
  const filterSelect = $("#category-filter");
  const formSelect = $("#pf-category");
  categories.forEach((c) => {
    filterSelect.insertAdjacentHTML("beforeend", `<option value="${c.id}">${c.label}</option>`);
    formSelect.insertAdjacentHTML("beforeend", `<option value="${c.id}">${c.label}</option>`);
  });
}

async function loadProductsPage() {
  const products = await getProducts();
  renderProductsTable(products);

  $("#product-search").addEventListener("input", () => renderProductsTable(products));
  $("#category-filter").addEventListener("change", () => renderProductsTable(products));
}

function renderProductsTable(allProducts) {
  const term = $("#product-search").value.trim().toLowerCase();
  const cat = $("#category-filter").value;

  const filtered = allProducts.filter((p) => {
    const matchesTerm = !term || p.name.toLowerCase().includes(term);
    const matchesCat = !cat || p.category === cat;
    return matchesTerm && matchesCat;
  });

  const tbody = $("#products-table-body");

  if (filtered.length === 0) {
    tbody.innerHTML = `<tr class="empty-row"><td colspan="7">No hay productos que coincidan con la búsqueda.</td></tr>`;
    return;
  }

  tbody.innerHTML = filtered.map((p) => {
    const allAvailable = p.variants.every((v) => v.available !== false);
    const catLabel = (categoriesCache.find((c) => c.id === p.category) || {}).label || p.category;
    return `
      <tr>
        <td><span class="swatch" style="background:${p.color};${p.imageUrl ? `background-image:url('${p.imageUrl}');background-size:cover;background-position:center;` : ""}"></span></td>
        <td><strong>${p.name}</strong>${p.tag ? `<div style="font-size:10.5px;color:var(--muted);">${p.tag}</div>` : ""}</td>
        <td>${catLabel}</td>
        <td>${p.variants.length}</td>
        <td>
          <button class="toggle-switch ${allAvailable ? "on" : ""}" data-toggle-available="${p.id}" title="${allAvailable ? "Disponible" : "No disponible"}">
            <span class="knob"></span>
          </button>
        </td>
        <td><span class="pill ${p.active ? "active" : "inactive"}">${p.active ? "Activo" : "Inactivo"}</span></td>
        <td>
          <div class="row-actions">
            <button class="btn btn-secondary btn-sm" data-sell="${p.id}">Vender</button>
            <button class="btn btn-secondary btn-sm" data-edit="${p.id}">Editar</button>
            <button class="icon-only-btn" data-delete="${p.id}" title="Eliminar">🗑</button>
          </div>
        </td>
      </tr>
    `;
  }).join("");

  tbody.querySelectorAll("[data-toggle-available]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const product = filtered.find((p) => p.id === btn.dataset.toggleAvailable);
      const makeAvailable = !product.variants.every((v) => v.available !== false);
      product.variants.forEach((v) => { v.available = makeAvailable; });
      try {
        await saveProduct(product);
        const products = await getProducts();
        renderProductsTable(products);
      } catch (err) {
        console.error("Error al cambiar disponibilidad:", err);
        alert("No se pudo actualizar la disponibilidad:\n\n" + (err.message || err));
      }
    });
  });
  tbody.querySelectorAll("[data-sell]").forEach((btn) => {
    btn.addEventListener("click", () => openSaleModal(filtered.find((p) => p.id === btn.dataset.sell)));
  });
  tbody.querySelectorAll("[data-edit]").forEach((btn) => {
    btn.addEventListener("click", () => openProductModal(filtered.find((p) => p.id === btn.dataset.edit)));
  });
  tbody.querySelectorAll("[data-delete]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!confirm("¿Eliminar este producto? Esta acción no se puede deshacer.")) return;
      try {
        await deleteProduct(btn.dataset.delete);
        const products = await getProducts();
        renderProductsTable(products);
      } catch (err) {
        console.error("Error al eliminar producto:", err);
        alert("No se pudo eliminar el producto:\n\n" + (err.message || err));
      }
    });
  });
}

// ---------- Modal de producto ----------
let editingVariants = [];
let editingProductId = null;
let editingImageUrl = null;

function openProductModal(product) {
  editingProductId = product ? product.id : null;
  editingVariants = product ? JSON.parse(JSON.stringify(product.variants)) : [];
  editingImageUrl = product ? product.imageUrl || null : null;

  $("#modal-product-title").textContent = product ? "Editar producto" : "Nuevo producto";
  $("#pf-name").value = product ? product.name : "";
  $("#pf-category").value = product ? product.category : (categoriesCache[0] || {}).id;
  $("#pf-tag").value = product ? product.tag : "";
  $("#pf-description").value = product ? product.description : "";
  $("#pf-color").value = product ? rgbToHex(product.color) : "#e8e3d6";
  $("#pf-active").value = product ? String(product.active) : "true";
  $("#pf-photo-input").value = "";
  renderPhotoPreview();

  renderVariantEditors();
  $("#modal-product").classList.remove("hidden");
}

function renderPhotoPreview() {
  const preview = $("#pf-photo-preview");
  preview.innerHTML = editingImageUrl
    ? `<img src="${editingImageUrl}" style="width:100%;height:100%;object-fit:cover;" />`
    : `<span style="font-size:10px;color:var(--muted);">Sin foto</span>`;
}

function rgbToHex(color) {
  // acepta ya sea un hex válido o lo deja igual (el catálogo ya usa hex)
  return /^#[0-9a-fA-F]{6}$/.test(color) ? color : "#e8e3d6";
}

function renderVariantEditors() {
  const wrap = $("#variants-editor-list");
  if (editingVariants.length === 0) {
    wrap.innerHTML = `<p style="font-size:11.5px;color:var(--muted);">Aún no hay variantes. Agrega al menos una.</p>`;
    return;
  }
  wrap.innerHTML = editingVariants.map((v, i) => `
    <div class="variant-editor">
      <div class="variant-editor-header">
        <span>Variante ${i + 1}</span>
        <button class="icon-only-btn" data-remove-variant="${i}" type="button">✕</button>
      </div>
      <div class="field">
        <label>Etiqueta</label>
        <input type="text" data-vfield="label" data-vindex="${i}" value="${v.label || ""}" placeholder="Ej. 500ml" />
      </div>
      <div class="field-row">
        <div class="field">
          <label>Precio detalle</label>
          <input type="number" step="0.01" data-vfield="retailPrice" data-vindex="${i}" value="${v.retailPrice ?? ""}" />
        </div>
        <div class="field">
          <label>Precio mayorista</label>
          <input type="number" step="0.01" data-vfield="wholesalePrice" data-vindex="${i}" value="${v.wholesalePrice ?? ""}" />
        </div>
      </div>
      <div class="field-row">
        <div class="field">
          <label>SKU</label>
          <input type="text" data-vfield="sku" data-vindex="${i}" value="${v.sku || ""}" placeholder="Opcional" />
        </div>
        <div class="field">
          <label>Disponible</label>
          <label style="display:flex;align-items:center;gap:8px;margin-top:6px;">
            <input type="checkbox" data-vfield="available" data-vindex="${i}" ${v.available !== false ? "checked" : ""} style="width:16px;height:16px;" />
            <span style="font-size:12px;color:var(--muted);">Se puede pedir ahora</span>
          </label>
        </div>
      </div>
    </div>
  `).join("");

  wrap.querySelectorAll('[data-vfield]:not([type="checkbox"])').forEach((input) => {
    input.addEventListener("input", () => {
      const idx = Number(input.dataset.vindex);
      editingVariants[idx][input.dataset.vfield] = input.type === "number" ? Number(input.value) : input.value;
    });
  });
  wrap.querySelectorAll('[data-vfield="available"]').forEach((checkbox) => {
    checkbox.addEventListener("change", () => {
      editingVariants[Number(checkbox.dataset.vindex)].available = checkbox.checked;
    });
  });
  wrap.querySelectorAll("[data-remove-variant]").forEach((btn) => {
    btn.addEventListener("click", () => {
      editingVariants.splice(Number(btn.dataset.removeVariant), 1);
      renderVariantEditors();
    });
  });
}

function setupProductModal() {
  $("#btn-new-product").addEventListener("click", () => openProductModal(null));

  $("#pf-photo-input").addEventListener("change", (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (file.size > 3 * 1024 * 1024) {
      alert("La foto es muy pesada (máximo 3MB). Intenta con una imagen más liviana.");
      e.target.value = "";
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      editingImageUrl = reader.result;
      // NOTA: en modo demostración la foto se guarda como texto (data URL) en
      // memoria. Con Supabase conectado, esto se reemplaza por una subida
      // real a Supabase Storage y aquí se guarda solo la URL pública resultante.
      renderPhotoPreview();
    };
    reader.readAsDataURL(file);
  });

  $("#btn-add-variant").addEventListener("click", () => {
    editingVariants.push({ id: `new-${Date.now()}`, label: "", sku: "", retailPrice: 0, wholesalePrice: 0, available: true });
    renderVariantEditors();
  });

  $("#btn-save-product").addEventListener("click", async () => {
    const name = $("#pf-name").value.trim();
    if (!name) { alert("El producto necesita un nombre."); return; }
    if (editingVariants.length === 0) { alert("Agrega al menos una variante (presentación) con su precio."); return; }
    if (!$("#pf-category").value) { alert("Selecciona una categoría antes de guardar."); return; }

    const product = {
      id: editingProductId || `p-${Date.now()}`,
      name,
      category: $("#pf-category").value,
      tag: $("#pf-tag").value.trim(),
      description: $("#pf-description").value.trim(),
      color: $("#pf-color").value,
      imageUrl: editingImageUrl,
      active: $("#pf-active").value === "true",
      variants: editingVariants,
    };

    const saveBtn = $("#btn-save-product");
    const originalText = saveBtn.textContent;
    saveBtn.textContent = "Guardando...";
    saveBtn.disabled = true;

    try {
      await saveProduct(product);
      closeModal("modal-product");
      const products = await getProducts();
      renderProductsTable(products);
    } catch (err) {
      console.error("Error al guardar producto:", err);
      alert("No se pudo guardar el producto:\n\n" + (err.message || err));
    } finally {
      saveBtn.textContent = originalText;
      saveBtn.disabled = false;
    }
  });
}

// ==========================================================================
// CAPA DE DATOS — ventas manuales
// ==========================================================================
async function getSales() {
  if (isLiveMode) {
    const { data, error } = await supabaseClient
      .from("ventas_manuales")
      .select("*, variantes_producto(etiqueta, productos(nombre))")
      .order("vendido_en", { ascending: false })
      .limit(100);
    if (error) throw error;
    return data;
  }
  return [...demoSales].sort((a, b) => new Date(b.soldAt) - new Date(a.soldAt));
}

async function registerSale({ productName, variantLabel, variantId, quantity, unitPrice }) {
  if (isLiveMode) {
    const { error } = await supabaseClient.from("ventas_manuales").insert({
      variante_id: variantId, cantidad: quantity, precio_unitario: unitPrice,
    });
    if (error) throw error;
    return;
  }
  demoSales.push({
    id: `s-${Date.now()}`, variantId, productName, variantLabel,
    quantity, unitPrice, soldAt: new Date().toISOString(),
  });
}

// ==========================================================================
// PÁGINA: VENTAS
// ==========================================================================
async function loadSalesPage() {
  const [products, sales] = await Promise.all([getProducts(), getSales()]);
  populateSaleVariantSelect(products);
  renderSalesPage(sales);
  if (!$("#report-from").value) setReportRangeToThisMonth();
}

function setReportRangeToThisMonth() {
  const now = new Date();
  const first = new Date(now.getFullYear(), now.getMonth(), 1);
  $("#report-from").value = toDateInputValue(first);
  $("#report-to").value = toDateInputValue(now);
}

function toDateInputValue(d) {
  return d.toISOString().slice(0, 10);
}

function populateSaleVariantSelect(products) {
  const select = $("#sf-variant");
  select.innerHTML = products.flatMap((p) =>
    p.variants.map((v, i) => `<option value="${p.id}::${i}">${p.name} — ${v.label}</option>`)
  ).join("");
}

function renderSalesPage(sales) {
  const now = new Date();
  const thisMonth = sales.filter((s) => {
    const d = new Date(s.soldAt || s.vendido_en);
    return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
  });
  const units = thisMonth.reduce((sum, s) => sum + Number(s.quantity || s.cantidad || 0), 0);
  const total = thisMonth.reduce((sum, s) => sum + Number(s.quantity || s.cantidad || 0) * Number(s.unitPrice || s.precio_unitario || 0), 0);

  $("#sales-month-units").textContent = units;
  $("#sales-month-total").textContent = money(total);

  const tbody = $("#sales-table-body");
  if (sales.length === 0) {
    tbody.innerHTML = `<tr class="empty-row"><td colspan="5">Aún no has registrado ninguna venta.</td></tr>`;
    return;
  }
  tbody.innerHTML = sales.slice(0, 30).map((s) => {
    const date = new Date(s.soldAt || s.vendido_en);
    const qty = s.quantity || s.cantidad;
    const price = s.unitPrice || s.precio_unitario;
    const productName = s.productName || (s.variantes_producto && s.variantes_producto.productos && s.variantes_producto.productos.nombre) || "—";
    const variantLabel = s.variantLabel || (s.variantes_producto && s.variantes_producto.etiqueta) || "—";
    return `
      <tr>
        <td>${date.toLocaleDateString("es-SV", { day: "2-digit", month: "short", year: "numeric" })}</td>
        <td>${productName}</td>
        <td>${variantLabel}</td>
        <td>${qty}</td>
        <td>${money(qty * price)}</td>
      </tr>
    `;
  }).join("");
}

let pendingSale = null;

function setupSaleModal() {
  $("#btn-new-sale").addEventListener("click", () => openSaleModal(null));

  $("#btn-sale-continue").addEventListener("click", async () => {
    const [productId, variantIdx] = $("#sf-variant").value.split("::");
    const qty = Math.max(1, Number($("#sf-quantity").value) || 1);
    const products = await getProducts();
    const product = products.find((p) => p.id === productId);
    const variant = product.variants[Number(variantIdx)];

    pendingSale = {
      productName: product.name, variantLabel: variant.label,
      variantId: variant.id, quantity: qty, unitPrice: variant.retailPrice,
    };

    $("#sale-confirm-text").textContent =
      `¿Confirmas que se vendió ${qty} unidad${qty === 1 ? "" : "es"} de ${product.name} (${variant.label})?`;
    $("#sale-modal-step-select").classList.add("hidden");
    $("#sale-modal-step-confirm").classList.remove("hidden");
    $("#btn-sale-continue").classList.add("hidden");
    $("#btn-sale-confirm").classList.remove("hidden");
  });

  $("#btn-sale-confirm").addEventListener("click", async () => {
    await registerSale(pendingSale);
    closeModal("modal-sale");
    loadSalesPage();
  });
}

function openSaleModal(product) {
  $("#sale-modal-step-select").classList.remove("hidden");
  $("#sale-modal-step-confirm").classList.add("hidden");
  $("#btn-sale-continue").classList.remove("hidden");
  $("#btn-sale-confirm").classList.add("hidden");
  $("#sf-quantity").value = 1;
  if (product) {
    const idx = Array.from($("#sf-variant").options).findIndex((o) => o.value.startsWith(product.id + "::"));
    if (idx >= 0) $("#sf-variant").selectedIndex = idx;
  }
  $("#modal-sale").classList.remove("hidden");
}

// ==========================================================================
// PÁGINA: SOLICITUDES MAYORISTAS
// ==========================================================================
async function loadWholesalePage() {
  const apps = await getWholesaleApps();
  renderWholesaleTable(apps);
}

function renderWholesaleTable(apps) {
  const tbody = $("#wholesale-table-body");
  if (apps.length === 0) {
    tbody.innerHTML = `<tr class="empty-row"><td colspan="6">No hay solicitudes todavía.</td></tr>`;
    return;
  }
  tbody.innerHTML = apps.map((a) => `
    <tr>
      <td><strong>${a.businessName || a.customerName}</strong><div style="font-size:10.5px;color:var(--muted);">${a.customerName}</div></td>
      <td>${a.phone}</td>
      <td>${a.email || "—"}</td>
      <td>${a.createdAt}</td>
      <td><span class="pill ${a.status}">${a.status[0].toUpperCase() + a.status.slice(1)}</span></td>
      <td>
        <div class="row-actions">
          ${a.status === "pendiente" ? `
            <button class="btn btn-primary btn-sm" data-approve="${a.id}">Aprobar</button>
            <button class="btn btn-danger btn-sm" data-reject="${a.id}">Rechazar</button>
          ` : ""}
          <button class="icon-only-btn" data-delete-wholesale="${a.id}" title="Eliminar cuenta">🗑</button>
        </div>
      </td>
    </tr>
  `).join("");

  tbody.querySelectorAll("[data-approve]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      await updateWholesaleStatus(btn.dataset.approve, "aprobado");
      loadWholesalePage();
    });
  });
  tbody.querySelectorAll("[data-reject]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      await updateWholesaleStatus(btn.dataset.reject, "rechazado");
      loadWholesalePage();
    });
  });
  tbody.querySelectorAll("[data-delete-wholesale]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!confirm("¿Eliminar esta cuenta mayorista por completo? El cliente perdería el acceso a precio mayorista y tendría que registrarse de nuevo.")) return;
      await deleteWholesaleAccount(btn.dataset.deleteWholesale);
      loadWholesalePage();
    });
  });
}

// ==========================================================================
// PÁGINA: CONFIGURACIÓN
// ==========================================================================
function setupConfigPage() {
  $("#config-supabase-url").value = CONFIG.SUPABASE_URL;
  $("#config-supabase-key").value = CONFIG.SUPABASE_ANON_KEY;

  $("#btn-save-config").addEventListener("click", () => {
    alert(
      "Por seguridad, estos valores no se guardan automáticamente desde el navegador.\n\n" +
      "Copia la URL y la llave, y pégalas en la constante CONFIG al inicio de admin/js/admin.js " +
      "(y también en js/app.js del sitio de clientes si aplica). Luego recarga el panel."
    );
  });
}

// ==========================================================================
// MODALES genéricos
// ==========================================================================
function closeModal(id) { $("#" + id).classList.add("hidden"); }
function setupModalClosers() {
  $$("[data-close-modal]").forEach((btn) => {
    btn.addEventListener("click", () => closeModal(btn.dataset.closeModal));
  });
  $$(".modal-overlay").forEach((overlay) => {
    overlay.addEventListener("click", (e) => { if (e.target === overlay) overlay.classList.add("hidden"); });
  });
}

// ==========================================================================
// INIT
// ==========================================================================
// ==========================================================================
// REPORTE DE VENTAS EN PDF
// ==========================================================================
function setupReportControls() {
  $("#btn-report-this-month").addEventListener("click", () => {
    setReportRangeToThisMonth();
    loadSalesPage();
  });

  $("#btn-download-pdf").addEventListener("click", async () => {
    const fromStr = $("#report-from").value;
    const toStr = $("#report-to").value;
    if (!fromStr || !toStr) { alert("Selecciona el rango de fechas del reporte."); return; }

    const from = new Date(fromStr + "T00:00:00");
    const to = new Date(toStr + "T23:59:59");
    if (from > to) { alert("La fecha 'desde' no puede ser después de la fecha 'hasta'."); return; }

    const allSales = await getSales();
    const filtered = allSales.filter((s) => {
      const d = new Date(s.soldAt || s.vendido_en);
      return d >= from && d <= to;
    });

    generateSalesPDF(filtered, from, to);
  });
}

function generateSalesPDF(sales, from, to) {
  if (!window.jspdf) { alert("No se pudo cargar el generador de PDF. Verifica tu conexión e intenta de nuevo."); return; }
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF();

  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.text("ADARA Cosmética Natural", 14, 18);
  doc.setFontSize(11);
  doc.setFont("helvetica", "normal");
  doc.text("Reporte de ventas", 14, 26);
  doc.setFontSize(9);
  doc.setTextColor(120, 115, 100);
  doc.text(`Del ${from.toLocaleDateString("es-SV")} al ${to.toLocaleDateString("es-SV")}`, 14, 32);

  let y = 44;
  doc.setTextColor(30, 30, 25);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.text("Fecha", 14, y);
  doc.text("Producto", 42, y);
  doc.text("Variante", 112, y);
  doc.text("Cant.", 155, y);
  doc.text("Subtotal", 175, y);
  y += 3;
  doc.setDrawColor(220, 216, 200);
  doc.line(14, y, 196, y);
  y += 6;

  doc.setFont("helvetica", "normal");
  let totalUnits = 0;
  let totalAmount = 0;

  if (sales.length === 0) {
    doc.setTextColor(140, 135, 120);
    doc.text("No hay ventas registradas en este rango de fechas.", 14, y);
    y += 8;
  }

  sales.forEach((s) => {
    if (y > 275) { doc.addPage(); y = 20; }
    const date = new Date(s.soldAt || s.vendido_en);
    const qty = Number(s.quantity || s.cantidad || 0);
    const price = Number(s.unitPrice || s.precio_unitario || 0);
    const subtotal = qty * price;
    totalUnits += qty;
    totalAmount += subtotal;

    const productName = s.productName || (s.variantes_producto && s.variantes_producto.productos && s.variantes_producto.productos.nombre) || "—";
    const variantLabel = s.variantLabel || (s.variantes_producto && s.variantes_producto.etiqueta) || "—";

    doc.setTextColor(60, 58, 51);
    doc.text(date.toLocaleDateString("es-SV"), 14, y);
    doc.text(String(productName).slice(0, 34), 42, y);
    doc.text(String(variantLabel).slice(0, 20), 112, y);
    doc.text(String(qty), 155, y);
    doc.text(money(subtotal), 175, y);
    y += 6;
  });

  y += 4;
  doc.setDrawColor(220, 216, 200);
  doc.line(14, y, 196, y);
  y += 8;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.setTextColor(30, 30, 25);
  doc.text(`Total unidades: ${totalUnits}`, 14, y);
  doc.text(`Total vendido: ${money(totalAmount)}`, 130, y);

  const fileName = `adara-ventas_${toDateInputValue(from)}_a_${toDateInputValue(to)}.pdf`;
  doc.save(fileName);
}

async function init() {
  setupLogin();
  setupSidebar();
  setupProductModal();
  setupSaleModal();
  setupReportControls();
  setupModalClosers();
  setupConfigPage();

  try {
    await populateCategoryFilters();
  } catch (err) {
    console.error("Error al cargar categorías:", err);
    alert("No se pudieron cargar las categorías desde Supabase:\n\n" + (err.message || err) + "\n\nRecarga la página para intentar de nuevo.");
  }
}

document.addEventListener("DOMContentLoaded", init);
