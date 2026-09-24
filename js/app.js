// ==========================================================================
// ADARA Cosmética Natural — lógica de la PWA (prototipo funcional)
// ==========================================================================
// CONFIGURACIÓN PENDIENTE — reemplazar antes de publicar:
const CONFIG = {
  WHATSAPP_NUMBER: "50300000000", // TODO: número real de WhatsApp Business (con código de país, sin +)
  ADMIN_WHATSAPP_NUMBER: "50300000000", // TODO: número donde TÚ recibes avisos de nuevas cuentas mayoristas
  STORE_ADDRESS: "4ta calle oriente, casa #2-7, Lourdes Colón, La Libertad. Referencia: a la par / dentro de Médico Lourdes.",
  SHIPPING_INFO: "Consulta la tarifa de tu zona con tu gestor de ventas", // TODO: reemplazar por tabla real de zonas
  SUPABASE_URL: "https://blkssnpdiyjsashxomiu.supabase.co", // conectado ✅
  SUPABASE_ANON_KEY: "sb_publishable_QW0Oq9uAK-UVaTJhUWRk5A_yW3-r31e", // conectado ✅
};

const isLiveMode = Boolean(CONFIG.SUPABASE_URL && CONFIG.SUPABASE_ANON_KEY);
let supabaseClient = null;
if (isLiveMode && window.supabase) {
  supabaseClient = window.supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY);
}

// ==========================================================================
// CATÁLOGO EN VIVO — reemplaza CATEGORIES/PRODUCTS (de data.js) con lo que
// haya guardado en Supabase, cuando está conectado. Mientras no haya
// productos reales cargados desde el panel admin, el catálogo se ve vacío
// aquí (data.js solo se usa como demo cuando Supabase no está conectado).
// ==========================================================================
async function loadLiveCatalog() {
  if (!isLiveMode) return; // sigue usando el catálogo de ejemplo de data.js

  const [catRes, prodRes] = await Promise.all([
    supabaseClient.from("categorias").select("*").order("orden"),
    supabaseClient
      .from("productos")
      .select("*, categorias(slug), variantes_producto(*)")
      .eq("activo", true)
      .order("nombre"),
  ]);

  if (!catRes.error && catRes.data) {
    CATEGORIES.length = 0;
    CATEGORIES.push({ id: "todos", label: "Todos", icon: "sparkles" });
    catRes.data.forEach((c) => CATEGORIES.push({ id: c.slug, label: c.nombre, icon: c.icono || "sparkles" }));
  }

  if (!prodRes.error && prodRes.data) {
    const liveProducts = prodRes.data
      .map((row) => ({
        id: row.id,
        name: row.nombre,
        category: row.categorias ? row.categorias.slug : null,
        tag: row.etiqueta || "",
        color: row.color_hex || "#e8e3d6",
        description: row.descripcion || "",
        imageUrl: row.imagen_url || null,
        variants: (row.variantes_producto || [])
          .filter((v) => v.disponible !== false)
          .map((v) => ({
            label: v.etiqueta,
            price: Number(v.precio_detalle),
            wholesalePrice: v.precio_mayorista != null ? Number(v.precio_mayorista) : Number(v.precio_detalle),
          })),
      }))
      .filter((p) => p.variants.length > 0); // oculta productos sin ninguna variante disponible

    PRODUCTS.length = 0;
    liveProducts.forEach((p) => PRODUCTS.push(p));
  }
}


const state = {
  category: "todos",
  search: "",
  cart: [], // { productId, variantIndex, qty }
  isWholesale: false, // true SOLO cuando wholesaleStatus === 'approved' — es lo que desbloquea precio mayorista
  wholesaleStatus: "none", // 'none' | 'pending' | 'approved' — controla el mensaje que ve el cliente
  activeProductId: null,
  deliveryMethod: "domicilio", // 'domicilio' | 'tienda'
  paymentMethod: null, // retail: 'efectivo' | 'transferencia'  |  wholesale: fijo 'transferencia_anticipo'
};

// ---------- Helpers ----------
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);
const money = (n) => `$${n.toFixed(2)}`;

function findProduct(id) {
  return PRODUCTS.find((p) => p.id === id);
}

function cartLines() {
  return state.cart.map((item) => {
    const product = findProduct(item.productId);
    const variant = product.variants[item.variantIndex];
    const unitPrice = state.isWholesale ? variant.wholesalePrice : variant.price;
    return { ...item, product, variant, unitPrice, lineTotal: unitPrice * item.qty };
  });
}

function cartCount() {
  return state.cart.reduce((sum, i) => sum + i.qty, 0);
}

function cartSubtotal() {
  return cartLines().reduce((sum, l) => sum + l.lineTotal, 0);
}

const CATEGORY_LABELS = {
  cabello: "Cabello",
  rostro: "Rostro",
  corporal: "Corporal",
  jabones: "Jabones",
  aceites: "Aceites",
  limitada: "Edición limitada",
};

// ==========================================================================
// RENDER: categorías
// ==========================================================================
function renderCategories() {
  const wrap = $("#categories");
  wrap.innerHTML = CATEGORIES.map((c) => `
    <button class="category-pill ${state.category === c.id ? "active" : ""}" data-cat="${c.id}">
      <span class="circle">${ICON(c.icon, 20)}</span>
      <span>${c.label}</span>
    </button>
  `).join("");

  wrap.querySelectorAll("[data-cat]").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.category = btn.dataset.cat;
      renderCategories();
      renderGrid();
    });
  });
}

// ==========================================================================
// RENDER: grid de productos
// ==========================================================================
function productCardQtyInCart(productId) {
  return state.cart.filter((i) => i.productId === productId).reduce((s, i) => s + i.qty, 0);
}

function renderGrid() {
  const grid = $("#product-grid");
  const term = state.search.trim().toLowerCase();

  const filtered = PRODUCTS.filter((p) => {
    const matchesCat = state.category === "todos" || p.category === state.category;
    const matchesSearch = !term || p.name.toLowerCase().includes(term);
    return matchesCat && matchesSearch;
  });

  if (filtered.length === 0) {
    grid.innerHTML = `<div class="empty-state">${ICON("leaf", 28)}<p>No encontramos productos con ese criterio.</p></div>`;
    return;
  }

  grid.innerHTML = filtered.map((p) => {
    const baseVariant = p.variants[0];
    const price = state.isWholesale ? baseVariant.wholesalePrice : baseVariant.price;
    const qtyInCart = productCardQtyInCart(p.id);
    return `
      <div class="product-card" data-product="${p.id}">
        <div class="thumb" style="background:${p.color};">
          ${p.imageUrl ? `<img src="${p.imageUrl}" alt="${p.name}" />` : ICON("flask", 26)}
          ${p.tag ? `<span class="tag">${p.tag}</span>` : ""}
        </div>
        <div class="info">
          <div class="name">${p.name}</div>
          <div class="meta">${baseVariant.label}</div>
          <div class="price-row">
            <span class="price">${money(price)}</span>
            ${qtyInCart > 0
              ? `<div class="qty-stepper" data-quick="${p.id}">
                   <button data-action="dec">${ICON("minus", 12)}</button>
                   <span class="count">${qtyInCart}</span>
                   <button data-action="inc">${ICON("plus", 12)}</button>
                 </div>`
              : `<button class="add-btn" data-quick-add="${p.id}">${ICON("plus", 15)}</button>`
            }
          </div>
        </div>
      </div>
    `;
  }).join("");

  grid.querySelectorAll(".product-card").forEach((card) => {
    card.addEventListener("click", (e) => {
      if (e.target.closest("[data-quick-add]") || e.target.closest("[data-quick]")) return;
      openProductDetail(card.dataset.product);
    });
  });

  grid.querySelectorAll("[data-quick-add]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      addToCart(btn.dataset.quickAdd, 0, 1);
      renderGrid();
      renderCartBar();
    });
  });

  grid.querySelectorAll("[data-quick]").forEach((stepper) => {
    stepper.querySelectorAll("button").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const pid = stepper.dataset.quick;
        const delta = btn.dataset.action === "inc" ? 1 : -1;
        adjustCartQty(pid, 0, delta);
        renderGrid();
        renderCartBar();
      });
    });
  });
}

// ==========================================================================
// CARRITO: mutaciones
// ==========================================================================
function addToCart(productId, variantIndex, qty) {
  const existing = state.cart.find((i) => i.productId === productId && i.variantIndex === variantIndex);
  if (existing) {
    existing.qty += qty;
  } else {
    state.cart.push({ productId, variantIndex, qty });
  }
}

function adjustCartQty(productId, variantIndex, delta) {
  const idx = state.cart.findIndex((i) => i.productId === productId && i.variantIndex === variantIndex);
  if (idx === -1) {
    if (delta > 0) addToCart(productId, variantIndex, delta);
    return;
  }
  state.cart[idx].qty += delta;
  if (state.cart[idx].qty <= 0) state.cart.splice(idx, 1);
}

function removeCartLine(productId, variantIndex) {
  const idx = state.cart.findIndex((i) => i.productId === productId && i.variantIndex === variantIndex);
  if (idx !== -1) state.cart.splice(idx, 1);
}

function renderCartBar() {
  const bar = $("#cart-bar");
  const badge = $("#nav-badge");
  const count = cartCount();
  if (count > 0) {
    bar.classList.remove("hidden");
    $("#cart-bar-count").textContent = `${count} producto${count === 1 ? "" : "s"}`;
    $("#cart-bar-total").textContent = money(cartSubtotal());
    badge.textContent = count;
    badge.classList.remove("hidden");
  } else {
    bar.classList.add("hidden");
    badge.classList.add("hidden");
  }
}

// ==========================================================================
// SHEET: detalle de producto
// ==========================================================================
function openProductDetail(productId) {
  state.activeProductId = productId;
  state.detailVariant = 0;
  state.detailQty = 1;
  renderProductDetail();
  openSheet("sheet-product");
}

function renderProductDetail() {
  const product = findProduct(state.activeProductId);
  const variant = product.variants[state.detailVariant];
  const price = state.isWholesale ? variant.wholesalePrice : variant.price;

  const body = $("#product-detail-body");
  body.innerHTML = `
    <div class="detail-hero ${product.imageUrl ? "zoomable" : ""}" style="background:${product.color};" id="detail-hero-img">
      ${product.imageUrl ? `<img src="${product.imageUrl}" alt="${product.name}" />` : ICON("flask", 42)}
      ${product.imageUrl ? `<span class="zoom-hint">${ICON("search", 13)}</span>` : ""}
    </div>
    <div class="detail-name">${product.name}</div>
    <div class="detail-meta">${CATEGORY_LABELS[product.category]} · 100% artesanal</div>
    <div class="detail-desc">${product.description}</div>
    <div class="detail-price" id="detail-price">${money(price)}</div>

    ${product.variants.length > 1 ? `
      <div class="variant-list" id="variant-list">
        ${product.variants.map((v, i) => `
          <div class="variant-option ${i === state.detailVariant ? "selected" : ""}" data-variant="${i}">
            <span>${v.label}</span>
            <span class="vprice">${money(state.isWholesale ? v.wholesalePrice : v.price)}</span>
          </div>
        `).join("")}
      </div>
    ` : ""}

    <div class="qty-row">
      <span class="label">Cantidad</span>
      <div class="stepper">
        <button id="detail-qty-dec">${ICON("minus", 14)}</button>
        <span class="count" id="detail-qty-count">${state.detailQty}</span>
        <button id="detail-qty-inc">${ICON("plus", 14)}</button>
      </div>
    </div>

    <div class="wholesale-banner ${state.isWholesale ? "active" : ""} ${state.wholesaleStatus === "pending" ? "pending" : ""}" id="wholesale-banner">
      ${state.wholesaleStatus === "approved"
        ? `<span style="display:flex;align-items:center;gap:6px;">${ICON("check-circle", 15)}Viendo precio mayorista</span>`
        : state.wholesaleStatus === "pending"
          ? `<span style="display:flex;align-items:center;gap:6px;">${ICON("info-circle", 15)}Tu cuenta está en revisión — pronto verás precio mayorista</span>`
          : `<span>¿Compra al por mayor?</span><span class="link">Iniciar sesión ↗</span>`
      }
    </div>

    <button class="primary-btn" id="btn-add-to-order">Agregar al pedido</button>
  `;

  if (product.imageUrl) {
    $("#detail-hero-img").addEventListener("click", () => openLightbox(product.imageUrl, product.name));
  }

  body.querySelectorAll("[data-variant]").forEach((el) => {
    el.addEventListener("click", () => {
      state.detailVariant = Number(el.dataset.variant);
      renderProductDetail();
    });
  });

  $("#detail-qty-dec").addEventListener("click", () => {
    state.detailQty = Math.max(1, state.detailQty - 1);
    $("#detail-qty-count").textContent = state.detailQty;
  });
  $("#detail-qty-inc").addEventListener("click", () => {
    state.detailQty += 1;
    $("#detail-qty-count").textContent = state.detailQty;
  });

  if (state.wholesaleStatus === "none") {
    $("#wholesale-banner").addEventListener("click", () => openSheet("sheet-auth"));
  }

  $("#btn-add-to-order").addEventListener("click", () => {
    addToCart(product.id, state.detailVariant, state.detailQty);
    renderCartBar();
    renderGrid();
    closeSheet("sheet-product");
  });
}

// ==========================================================================
// SHEET: carrito / checkout
// ==========================================================================
function openCart() {
  renderCartSheet();
  openSheet("sheet-cart");
}

function renderCartSheet() {
  const badge = $("#cart-type-badge");
  badge.textContent = state.isWholesale ? "Cliente mayorista" : "Cliente al detalle";
  badge.classList.toggle("wholesale", state.isWholesale);

  const lines = cartLines();
  const body = $("#cart-body");

  if (lines.length === 0) {
    body.innerHTML = `<div class="empty-state" style="padding:30px 0;">${ICON("bag-off", 26)}<p>Tu pedido está vacío.<br>Agrega productos desde el catálogo.</p></div>`;
    return;
  }

  const subtotal = cartSubtotal();
  const isWholesale = state.isWholesale;

  if (isWholesale) {
    state.paymentMethod = "transferencia_anticipo";
  } else if (!state.paymentMethod || state.paymentMethod === "transferencia_anticipo") {
    state.paymentMethod = "efectivo";
  }

  const itemsHtml = lines.map((l) => `
    <div class="cart-item">
      <div class="thumb" style="background:${l.product.color};">${ICON("flask", 16)}</div>
      <div class="body">
        <div class="name">${l.product.name}</div>
        <div class="variant">${l.variant.label}</div>
        <div class="price">${money(l.unitPrice)} c/u</div>
      </div>
      <div class="actions">
        <div class="qty-stepper" data-line="${l.productId}:${l.variantIndex}">
          <button data-action="dec">${ICON("minus", 12)}</button>
          <span class="count">${l.qty}</span>
          <button data-action="inc">${ICON("plus", 12)}</button>
        </div>
        <button class="remove-line-btn" data-remove-line="${l.productId}:${l.variantIndex}">${ICON("trash", 13)}<span>Quitar</span></button>
      </div>
    </div>
  `).join("");

  const contactFormHtml = `
    <div class="form-block">
      <div class="block-title">Datos de contacto</div>
      <label class="field-label">Nombre completo</label>
      <input class="field-input" id="field-name" type="text" placeholder="Nombre completo" />
      <label class="field-label">Teléfono</label>
      <input class="field-input" id="field-phone" type="text" placeholder="Teléfono" />
      <label class="field-label">Ubicación de entrega</label>
      <input class="field-input" id="field-location" type="text" placeholder="Dirección o referencia" />
    </div>
  `;

  const deliveryHtml = `
    <div class="form-block">
      <div class="block-title">Método de entrega</div>
      <div class="choice-row">
        <div class="choice-card ${state.deliveryMethod === "domicilio" ? "selected" : ""}" data-delivery="domicilio">
          <span class="ic">${ICON("truck", 18)}</span>
          <div class="clabel">Envío a domicilio</div>
          <div class="csub">${CONFIG.SHIPPING_INFO}</div>
        </div>
        <div class="choice-card ${state.deliveryMethod === "tienda" ? "selected" : ""}" data-delivery="tienda">
          <span class="ic">${ICON("store", 18)}</span>
          <div class="clabel">Retiro en tienda</div>
          <div class="csub">${CONFIG.STORE_ADDRESS}</div>
        </div>
      </div>
    </div>
  `;

  let paymentHtml = "";
  if (isWholesale) {
    paymentHtml = `
      <div class="form-block">
        <div class="block-title">Método de pago</div>
        <div class="choice-card selected" style="text-align:left;display:flex;align-items:center;gap:10px;">
          <span style="color:var(--sage);">${ICON("bank", 20)}</span>
          <div>
            <div class="clabel" style="margin-top:0;">Transferencia bancaria</div>
            <div class="csub">Requerido para pedidos al por mayor · 50% de anticipo</div>
          </div>
        </div>
        <div class="notice">${ICON("camera", 15)}<span>Envía la captura del comprobante a tu gestor de ventas por WhatsApp para confirmar tu pedido.</span></div>
      </div>
    `;
  } else {
    paymentHtml = `
      <div class="form-block">
        <div class="block-title">Método de pago</div>
        <div class="choice-row">
          <div class="choice-card ${state.paymentMethod === "efectivo" ? "selected" : ""}" data-payment="efectivo">
            <span class="ic">${ICON("cash", 18)}</span>
            <div class="clabel">Contra entrega efectivo</div>
            <div class="csub">Pagas en efectivo al recibir</div>
          </div>
          <div class="choice-card ${state.paymentMethod === "transferencia" ? "selected" : ""}" data-payment="transferencia">
            <span class="ic">${ICON("bank", 18)}</span>
            <div class="clabel">Contra entrega transferencia</div>
            <div class="csub">Transfieres al recibir</div>
          </div>
        </div>
        ${state.paymentMethod === "transferencia" ? `<div class="notice">${ICON("camera", 15)}<span>Envía la captura del comprobante a tu gestor de ventas por WhatsApp al momento de la entrega.</span></div>` : ""}
      </div>
    `;
  }

  let totalsHtml = "";
  if (isWholesale) {
    const advance = subtotal * 0.5;
    totalsHtml = `
      <div class="totals">
        <div class="totals-row"><span>Subtotal</span><span>${money(subtotal)}</span></div>
        <div class="totals-row"><span>Envío</span><span>Por confirmar</span></div>
        <div class="totals-row main"><span>Anticipo a pagar (50%)</span><span>${money(advance)}</span></div>
        <div class="totals-row sub"><span>Restante contra entrega</span><span>${money(subtotal - advance)}</span></div>
      </div>
    `;
  } else {
    totalsHtml = `
      <div class="totals">
        <div class="totals-row"><span>Subtotal</span><span>${money(subtotal)}</span></div>
        <div class="totals-row"><span>Envío</span><span>Por confirmar</span></div>
        <div class="totals-row main"><span>Total a pagar al recibir</span><span>${money(subtotal)}</span></div>
      </div>
    `;
  }

  body.innerHTML = `
    ${itemsHtml}
    ${contactFormHtml}
    ${deliveryHtml}
    ${paymentHtml}
    ${totalsHtml}
    <button class="primary-btn" id="btn-send-order" style="display:flex;align-items:center;justify-content:center;gap:6px;">${ICON("whatsapp", 16)}Enviar pedido por WhatsApp</button>
  `;

  body.querySelectorAll("[data-line]").forEach((stepper) => {
    const [pid, vidx] = stepper.dataset.line.split(":");
    stepper.querySelectorAll("button").forEach((btn) => {
      btn.addEventListener("click", () => {
        adjustCartQty(pid, Number(vidx), btn.dataset.action === "inc" ? 1 : -1);
        renderCartSheet();
        renderCartBar();
        renderGrid();
      });
    });
  });

  body.querySelectorAll("[data-remove-line]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const [pid, vidx] = btn.dataset.removeLine.split(":");
      removeCartLine(pid, Number(vidx));
      renderCartSheet();
      renderCartBar();
      renderGrid();
    });
  });

  body.querySelectorAll("[data-delivery]").forEach((el) => {
    el.addEventListener("click", () => {
      state.deliveryMethod = el.dataset.delivery;
      renderCartSheet();
    });
  });

  body.querySelectorAll("[data-payment]").forEach((el) => {
    el.addEventListener("click", () => {
      state.paymentMethod = el.dataset.payment;
      renderCartSheet();
    });
  });

  $("#btn-send-order").addEventListener("click", handleSendOrder);
}

// ==========================================================================
// ENVÍO DE PEDIDO → WhatsApp
// ==========================================================================
function handleSendOrder() {
  const name = $("#field-name").value.trim();
  const phone = $("#field-phone").value.trim();
  const location = $("#field-location").value.trim();

  if (!name || !phone || !location) {
    alert("Por favor completa nombre, teléfono y ubicación de entrega antes de enviar tu pedido.");
    return;
  }

  const lines = cartLines();
  const subtotal = cartSubtotal();
  const orderId = "A-" + Math.floor(1000 + Math.random() * 9000);
  const isWholesale = state.isWholesale;

  const itemsText = lines.map((l) => `• ${l.qty}x ${l.product.name} (${l.variant.label}) — ${money(l.lineTotal)}`).join("%0A");

  const deliveryText = state.deliveryMethod === "domicilio" ? "Envío a domicilio" : "Retiro en tienda";
  let paymentText;
  let totalDue;
  if (isWholesale) {
    const advance = subtotal * 0.5;
    paymentText = `Transferencia — 50% de anticipo ($${advance.toFixed(2)}), restante contra entrega ($${(subtotal - advance).toFixed(2)})`;
    totalDue = advance;
  } else if (state.paymentMethod === "transferencia") {
    paymentText = `Contra entrega — transferencia al recibir`;
    totalDue = subtotal;
  } else {
    paymentText = `Contra entrega — efectivo al recibir`;
    totalDue = subtotal;
  }

  const message =
    `*Nuevo pedido ADARA — ${orderId}*%0A` +
    `Tipo de cliente: ${isWholesale ? "Mayorista" : "Consumidor final"}%0A%0A` +
    `*Productos:*%0A${itemsText}%0A%0A` +
    `*Cliente:* ${name}%0A` +
    `*Teléfono:* ${phone}%0A` +
    `*Entrega:* ${deliveryText} — ${location}%0A` +
    `*Pago:* ${paymentText}%0A` +
    `*Subtotal:* $${subtotal.toFixed(2)}`;

  const waLink = `https://wa.me/${CONFIG.WHATSAPP_NUMBER}?text=${message}`;

  $("#confirm-order-id").textContent = `#${orderId}`;
  $("#confirm-summary").innerHTML = `
    <div class="totals-row"><span>Pedido</span><span style="font-weight:600;color:var(--ink);">#${orderId}</span></div>
    <div class="totals-row"><span>Total</span><span style="font-weight:600;color:var(--ink);">${money(totalDue)}</span></div>
    <div class="totals-row"><span>Pago</span><span style="font-weight:600;color:var(--ink);">${paymentText}</span></div>
  `;
  $("#btn-whatsapp-link").href = waLink;

  state.cart = [];
  state.paymentMethod = null;
  renderCartBar();
  renderGrid();

  closeSheet("sheet-cart");
  openSheet("sheet-confirm");
}

// ==========================================================================
// AUTENTICACIÓN MAYORISTA — cuenta y catálogo disponibles de inmediato;
// el precio mayorista queda pendiente hasta que el admin apruebe la
// solicitud desde el panel. Incluye aviso al admin y recuperación de
// contraseña. Usa Supabase Auth cuando está conectado (CONFIG.SUPABASE_URL/KEY);
// mientras tanto funciona en modo demostración.
// ==========================================================================
function showAuthView(view) {
  $("#auth-login-form").classList.toggle("hidden", view !== "login");
  $("#auth-register-form").classList.toggle("hidden", view !== "register");
  $("#auth-forgot-form").classList.toggle("hidden", view !== "forgot");
  $("#auth-tabs").classList.toggle("hidden", view === "forgot");
  $("#auth-hero-title").textContent = view === "forgot" ? "Recuperar contraseña" : "Precios especiales al por mayor";
  $("#auth-hero-sub").textContent = view === "forgot"
    ? "Te enviaremos un enlace para restablecerla."
    : "Inicia sesión o crea tu cuenta para ver precios mayoristas y hacer pedidos al por mayor.";
}

function showAuthError(elId, message, success = false) {
  const el = $(elId);
  el.textContent = message;
  el.classList.remove("hidden");
  el.classList.toggle("success", success);
}
function hideAuthError(elId) { $(elId).classList.add("hidden"); }

// Notifica al administrador por WhatsApp que hay una cuenta mayorista nueva
// (no requiere backend — funciona ya mismo, esté o no Supabase conectado).
function notifyAdminNewWholesale({ name, phone, email }) {
  const message =
    `*Nueva cuenta mayorista registrada*%0A` +
    `Nombre/negocio: ${name}%0A` +
    `Teléfono: ${phone}%0A` +
    `Correo: ${email}%0A%0A` +
    `Se registró y ya puede navegar el catálogo — pero aún NO ve precio mayorista. Apruébala desde el panel admin cuando puedas.`;
  const link = `https://wa.me/${CONFIG.ADMIN_WHATSAPP_NUMBER}?text=${message}`;
  window.open(link, "_blank");
}

function setupAuthSheet() {
  $("#tab-login").addEventListener("click", () => { showAuthView("login"); $("#tab-login").classList.add("active"); $("#tab-register").classList.remove("active"); });
  $("#tab-register").addEventListener("click", () => { showAuthView("register"); $("#tab-register").classList.add("active"); $("#tab-login").classList.remove("active"); });
  $("#btn-goto-forgot").addEventListener("click", () => showAuthView("forgot"));
  $("#btn-back-to-login").addEventListener("click", () => { showAuthView("login"); $("#tab-login").classList.add("active"); $("#tab-register").classList.remove("active"); });

  // ---------- Iniciar sesión ----------
  $("#btn-login").addEventListener("click", async () => {
    hideAuthError("#login-error");
    const email = $("#login-email").value.trim();
    const password = $("#login-password").value;
    if (!email || !password) { showAuthError("#login-error", "Ingresa tu correo y contraseña."); return; }

    if (isLiveMode) {
      const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password });
      if (error) { showAuthError("#login-error", "Correo o contraseña incorrectos."); return; }

      // Consulta si el admin ya aprobó esta cuenta (clientes.tipo === 'mayorista')
      const { data: cliente } = await supabaseClient
        .from("clientes").select("tipo").eq("auth_user_id", data.user.id).single();
      if (cliente && cliente.tipo === "mayorista") {
        state.wholesaleStatus = "approved"; state.isWholesale = true;
      } else {
        state.wholesaleStatus = "pending"; state.isWholesale = false;
      }
      finishLoginSuccess();
    } else {
      // Modo demostración: sin cuentas reales, simula una cuenta YA APROBADA
      // para que puedas ver cómo se ve el precio mayorista desbloqueado.
      state.wholesaleStatus = "approved";
      state.isWholesale = true;
      finishLoginSuccess();
    }
  });

  // ---------- Crear cuenta (queda pendiente de aprobación para precios) ----------
  $("#btn-register").addEventListener("click", async () => {
    hideAuthError("#register-error");
    const name = $("#register-name").value.trim();
    const phone = $("#register-phone").value.trim();
    const email = $("#register-email").value.trim();
    const password = $("#register-password").value;

    if (!name || !phone || !email || !password) { showAuthError("#register-error", "Completa todos los campos."); return; }
    if (password.length < 6) { showAuthError("#register-error", "La contraseña debe tener al menos 6 caracteres."); return; }

    if (isLiveMode) {
      const { data, error } = await supabaseClient.auth.signUp({ email, password });
      if (error) { showAuthError("#register-error", error.message); return; }

      // El cliente se crea como 'detalle' (precio normal) — el trigger
      // aprobar_mayorista() lo cambia a 'mayorista' cuando el admin apruebe
      // la solicitud desde el panel (ver database/schema.sql).
      const { data: clienteRow } = await supabaseClient.from("clientes").insert({
        auth_user_id: data.user ? data.user.id : null,
        nombre: name, telefono: phone, correo: email, tipo: "detalle",
      }).select().single();

      if (clienteRow) {
        await supabaseClient.from("solicitudes_mayorista").insert({
          cliente_id: clienteRow.id, nombre_negocio: name, estado: "pendiente",
        });
      }
    }

    // El catálogo y la cuenta quedan disponibles de inmediato — solo el
    // precio mayorista queda a la espera de que el admin apruebe:
    state.wholesaleStatus = "pending";
    state.isWholesale = false;
    notifyAdminNewWholesale({ name, phone, email });
    finishLoginSuccess();
  });

  // ---------- Recuperar contraseña ----------
  $("#btn-send-reset").addEventListener("click", async () => {
    hideAuthError("#forgot-message");
    const email = $("#forgot-email").value.trim();
    if (!email) { showAuthError("#forgot-message", "Ingresa tu correo."); return; }

    if (isLiveMode) {
      const { error } = await supabaseClient.auth.resetPasswordForEmail(email);
      if (error) { showAuthError("#forgot-message", "No pudimos enviar el enlace. Verifica tu correo."); return; }
      showAuthError("#forgot-message", "Listo. Revisa tu correo para restablecer tu contraseña.", true);
    } else {
      showAuthError("#forgot-message", "La recuperación de contraseña estará activa en cuanto se conecte la cuenta a Supabase.", true);
    }
  });

  function finishLoginSuccess() {
    closeSheet("sheet-auth");
    renderGrid();
    if (state.activeProductId) renderProductDetail();
  }
}

// ==========================================================================
// LIGHTBOX — vista ampliada de la foto del producto
// ==========================================================================
function openLightbox(src, alt) {
  $("#lightbox-img").src = src;
  $("#lightbox-img").alt = alt || "";
  openSheet("sheet-lightbox");
}

// ==========================================================================
// SHEETS genéricos
// ==========================================================================
function openSheet(id) {
  $("#" + id).classList.remove("hidden");
  if (id === "sheet-auth") {
    showAuthView("login");
    $("#tab-login").classList.add("active");
    $("#tab-register").classList.remove("active");
    hideAuthError("#login-error");
    hideAuthError("#register-error");
    hideAuthError("#forgot-message");
  }
}
function closeSheet(id) { $("#" + id).classList.add("hidden"); }

function setupSheetClosers() {
  $$("[data-close]").forEach((btn) => {
    btn.addEventListener("click", () => closeSheet(btn.dataset.close));
  });
  $$(".sheet-overlay").forEach((overlay) => {
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) overlay.classList.add("hidden");
    });
  });
}

// ==========================================================================
// NAV inferior + accesos rápidos
// ==========================================================================
function setupNav() {
  $$(".nav-item").forEach((btn) => {
    btn.addEventListener("click", () => {
      $$(".nav-item").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      const target = btn.dataset.nav;
      if (target === "cart") openCart();
      if (target === "account") openSheet("sheet-auth");
      if (target === "nosotros") openSheet("sheet-nosotros");
      if (target === "categories") document.getElementById("categories").scrollIntoView({ behavior: "smooth" });
      if (target === "home") window.scrollTo({ top: 0, behavior: "smooth" });
    });
  });

  $("#cart-bar").addEventListener("click", openCart);
  $("#btn-header-cart").addEventListener("click", openCart);
  $("#btn-account").addEventListener("click", () => openSheet("sheet-auth"));
  $("#btn-continue-shopping").addEventListener("click", () => closeSheet("sheet-confirm"));

  $("#search-input").addEventListener("input", (e) => {
    state.search = e.target.value;
    renderGrid();
  });
}

// ==========================================================================
// Sección "Nosotros"
// ==========================================================================
function setupAbout() {
  $("#about-shipping-title").innerHTML = `${ICON("truck", 15)}<span>Envíos</span>`;
  $("#about-store-title").innerHTML = `${ICON("store", 15)}<span>Punto de venta</span>`;
  $("#about-contact-title").innerHTML = `${ICON("whatsapp", 15)}<span>Contacto</span>`;
  $("#about-store-address").textContent = CONFIG.STORE_ADDRESS;
  $("#about-whatsapp-link").href = `https://wa.me/${CONFIG.WHATSAPP_NUMBER}`;
}

// ==========================================================================
// Inyección de íconos estáticos (elementos que no se regeneran en cada render)
// ==========================================================================
function injectStaticIcons() {
  $("#btn-header-cart").innerHTML = ICON("shopping-cart", 17);
  $("#btn-account").innerHTML = ICON("user", 17);
  $("#search-icon").innerHTML = ICON("search", 16);
  $("#cart-bar-icon").innerHTML = ICON("shopping-bag", 16);
  $("#nav-ic-home").innerHTML = ICON("home", 19);
  $("#nav-ic-categories").innerHTML = ICON("grid", 19);
  $("#nav-ic-cart").innerHTML = ICON("shopping-bag", 19);
  $("#nav-ic-nosotros").innerHTML = ICON("leaf", 19);
  $("#nav-ic-account").innerHTML = ICON("user", 19);
  $("#auth-hero-icon").innerHTML = ICON("store", 22);
  $("#notice-icon").innerHTML = ICON("info-circle", 15);
  $("#confirm-check-icon").innerHTML = ICON("check", 28);
  $("#confirm-wa-icon").innerHTML = ICON("whatsapp", 16);

  $$(".close-x").forEach((btn) => {
    btn.innerHTML = ICON("x", 15);
  });
}

// ==========================================================================
// INIT
// ==========================================================================
async function init() {
  injectStaticIcons();
  setupNav();
  setupSheetClosers();
  setupAuthSheet();
  setupAbout();

  if (isLiveMode) {
    $("#product-grid").innerHTML = `<div class="empty-state">${ICON("leaf", 26)}<p>Cargando catálogo...</p></div>`;
    try {
      await loadLiveCatalog();
    } catch (e) {
      console.error("No se pudo cargar el catálogo desde Supabase:", e);
    }
  }

  renderCategories();
  renderGrid();
  renderCartBar();

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("sw.js").catch(() => {
      /* silencioso: si falla, la app sigue funcionando en línea */
    });
  }
}

document.addEventListener("DOMContentLoaded", init);

// ==========================================================================
// NOTA PARA DESARROLLO FUTURO
// ==========================================================================
// Este prototipo guarda el carrito y la sesión en memoria (se reinicia al
// recargar la página). En la versión conectada a Supabase, se reemplazará:
//   1. `state.cart`            → sincronizado con la tabla `pedidos` / `detalle_pedido`
//   2. `state.isWholesale`     → sesión real de Supabase Auth + validación
//                                 del estado "aprobado" en `solicitudes_mayorista`
//   3. CONFIG.WHATSAPP_NUMBER  → número real de WhatsApp Business
//   4. CONFIG.SHIPPING_INFO    → tabla real `zonas_envio`
//   5. PRODUCTS (data.js)      → catálogo completo (80 productos) cargado desde
//                                 las tablas `productos` / `variantes_producto`,
//                                 editable desde el panel admin (ver /admin)
