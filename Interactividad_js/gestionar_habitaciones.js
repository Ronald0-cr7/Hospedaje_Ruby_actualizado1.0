// GESTIÓN DE HABITACIONES — conectado a Supabase
// Tablas usadas: habitaciones, tipo_habitacion, reserva_habitacion, clientes, metodo_pago

const iconosPorTipo = { "Matrimonial": "🛏️", "Doble": "🛏️🛏️" };
const estadosValidos = ["Disponible", "Ocupada", "Limpieza", "Mantenimiento"];
const coloresEstados = { "Disponible":"disponible","Ocupada":"ocupada","Limpieza":"limpieza","Mantenimiento":"mantenimiento" };

// Estado en memoria, recargado desde Supabase
let habitaciones = [];          // [{ id_habitacion, numero_habitacion, tipo, piso, estado, inicio_ocupacion, precioBase }]
let reservasActivas = {};       // { numero_habitacion: { clienteNombre, fechaSalida, reservaId } }
const contadoresActivos = {};

// Datos auxiliares para el formulario de reserva rápida
let clientesReserva = [];       // clientes ya registrados (para autocompletar)
let metodosPagoReserva = [];    // métodos de pago disponibles

document.addEventListener("DOMContentLoaded", () => {
    inicializarHabitaciones();
    cargarClientesReserva();
    cargarMetodosPagoReserva();
    setInterval(sincronizarEstadosDesdeReservas, 30000);
});

async function inicializarHabitaciones() {
    await cargarHabitaciones();
    await sincronizarEstadosDesdeReservas();
}

async function cargarHabitaciones() {
    const { data, error } = await supabaseClient
        .from('habitaciones')
        .select('id_habitacion, numero_habitacion, piso, estado, inicio_ocupacion, precio_base, tipo_habitacion(nombre)')
        .order('numero_habitacion', { ascending: true });

    if (error) { manejarErrorSupabase(error, 'No se pudieron cargar las habitaciones.'); return; }

    habitaciones = (data || []).map(h => ({
        id: h.id_habitacion,
        numero: h.numero_habitacion,
        piso: h.piso,
        estado: h.estado,
        inicioOcupacion: h.inicio_ocupacion,
        precioBase: Number(h.precio_base) || 0,
        tipo: h.tipo_habitacion?.nombre || 'Matrimonial'
    }));

    renderizarTodas();
    actualizarEstadisticas();
    iniciarContadores();
}

async function cargarReservasActivas() {
    // Ya no se filtra por fecha_salida: esa fecha ya no se ingresa manualmente al
    // crear la reserva (se guarda un valor provisional igual a fecha_entrada) y
    // solo pasa a ser real cuando se presiona "Registrar salida". Por eso una
    // reserva se considera activa únicamente mientras estado_habitacion = 'Ocupada'.
    const { data, error } = await supabaseClient
        .from('reserva_habitacion')
        .select('reserva_id, id_habitacion, fecha_salida, estado_habitacion, clientes(apellidos_nombres)')
        .eq('estado_habitacion', 'Ocupada');

    if (error) { manejarErrorSupabase(error, 'No se pudieron cargar las reservas activas.'); return; }

    reservasActivas = {};
    (data || []).forEach(r => {
        const hab = habitaciones.find(h => h.id === r.id_habitacion);
        if (!hab) return;
        reservasActivas[hab.numero] = {
            reservaId: r.reserva_id,
            clienteNombre: r.clientes?.apellidos_nombres || 'Cliente',
            fechaSalida: r.fecha_salida
        };
    });
}

// ── DATOS AUXILIARES PARA LA RESERVA RÁPIDA ───────────────────

async function cargarClientesReserva() {
    const { data, error } = await supabaseClient
        .from('clientes')
        .select('id_cliente, apellidos_nombres, fecha_nacimiento, dni, distrito_ciudad')
        .order('apellidos_nombres', { ascending: true });
    if (error) { manejarErrorSupabase(error, 'No se pudieron cargar los clientes.'); return; }
    clientesReserva = data || [];
    poblarSelectClientesRapido();
}

async function cargarMetodosPagoReserva() {
    const { data, error } = await supabaseClient
        .from('metodo_pago')
        .select('id_metodo_pago, nombre')
        .order('id_metodo_pago');
    if (error) { manejarErrorSupabase(error, 'No se pudieron cargar los métodos de pago.'); return; }
    metodosPagoReserva = data || [];
    poblarSelectMetodoPagoRapido();
}

function poblarSelectClientesRapido() {
    const sel = document.getElementById("rr-cliente-registrado");
    if (!sel) return;
    sel.innerHTML = '<option value="">-- Cliente nuevo --</option>';
    clientesReserva.forEach(c => {
        const opt = document.createElement("option");
        opt.value = c.id_cliente;
        opt.textContent = `${c.apellidos_nombres} - DNI: ${c.dni}`;
        opt.dataset.nombre = c.apellidos_nombres;
        opt.dataset.fechaNac = c.fecha_nacimiento || '';
        opt.dataset.dni = c.dni;
        opt.dataset.residencia = c.distrito_ciudad || '';
        sel.appendChild(opt);
    });
}

function poblarSelectMetodoPagoRapido() {
    const sel = document.getElementById("rr-metodo-pago");
    if (!sel) return;
    sel.innerHTML = '<option value="">Seleccione</option>';
    metodosPagoReserva.forEach(m => {
        const opt = document.createElement("option");
        opt.value = m.nombre;
        opt.textContent = m.nombre;
        sel.appendChild(opt);
    });
}

function obtenerHabitacionPorNumero(numero) {
    return habitaciones.find(h => String(h.numero) === String(numero));
}

// ── GENERACIÓN AUTOMÁTICA DE ID DE RESERVA ────────────────────
// El ID nunca se escribe a mano: se arma con timestamp + sufijo aleatorio
// y se valida contra las reservas activas conocidas para evitar choques.
function generarIdReservaAutomatico() {
    let id;
    const existentes = Object.values(reservasActivas).map(r => r.reservaId);
    do {
        const ts = Date.now().toString(36).toUpperCase();
        const rand = Math.random().toString(36).slice(2, 6).toUpperCase();
        id = `RES-${ts}-${rand}`;
    } while (existentes.includes(id));
    return id;
}

// REQUISITO 8: Condicionar estado — si está Ocupada no se puede cambiar desde aquí
async function cambiarEstado(numero, nuevoEstado) {
    if (!estadosValidos.includes(nuevoEstado)) return;
    const hab = obtenerHabitacionPorNumero(numero);
    if (!hab) return;

    if (hab.estado === "Ocupada") {
        const reservaActiva = reservasActivas[numero];
        if (reservaActiva) {
            alert(`⚠️ La habitación ${numero} está en uso activo.\nCliente: ${reservaActiva.clienteNombre}\n\nNo se puede cambiar el estado mientras esté ocupada. Usa "Registrar salida" primero.`);
            cerrarModal();
            return;
        }
    }

    const payload = { estado: nuevoEstado };
    payload.inicio_ocupacion = nuevoEstado === "Ocupada" ? new Date().toISOString() : null;

    const { error } = await supabaseClient
        .from('habitaciones')
        .update(payload)
        .eq('id_habitacion', hab.id);

    if (error) { manejarErrorSupabase(error, 'No se pudo cambiar el estado de la habitación.'); return; }

    if (nuevoEstado !== "Ocupada" && contadoresActivos[numero]) {
        clearInterval(contadoresActivos[numero]);
        delete contadoresActivos[numero];
    }

    cerrarModal();
    await cargarHabitaciones();
    await cargarReservasActivas();
    renderizarTodas();
}

// REQUISITO 9: Contador de tiempo de alquiler
function iniciarContadores() {
    Object.keys(contadoresActivos).forEach(n => clearInterval(contadoresActivos[n]));

    habitaciones.filter(h => h.estado === "Ocupada" && h.inicioOcupacion).forEach(h => {
        const inicio = new Date(h.inicioOcupacion);
        contadoresActivos[h.numero] = setInterval(() => {
            const el = document.getElementById(`contador-${h.numero}`);
            if (!el) return;
            const diff = Math.floor((new Date() - inicio) / 1000);
            const hh = Math.floor(diff / 3600).toString().padStart(2,'0');
            const mm = Math.floor((diff % 3600) / 60).toString().padStart(2,'0');
            const ss = (diff % 60).toString().padStart(2,'0');
            el.textContent = `⏱ ${hh}:${mm}:${ss}`;
        }, 1000);
    });
}

// Sincronizar estados desde reservas activas (por si una reserva venció o empezó)
async function sincronizarEstadosDesdeReservas() {
    await cargarReservasActivas();

    const ahora = new Date();
    const actualizaciones = [];

    habitaciones.forEach(h => {
        const activa = reservasActivas[h.numero];
        if (activa && h.estado !== "Ocupada") {
            actualizaciones.push({ id: h.id, estado: "Ocupada", inicio_ocupacion: new Date().toISOString() });
        } else if (!activa && h.estado === "Ocupada") {
            // La reserva venció: pasar a Limpieza automáticamente
            actualizaciones.push({ id: h.id, estado: "Limpieza", inicio_ocupacion: null });
        }
    });

    for (const u of actualizaciones) {
        await supabaseClient.from('habitaciones').update({ estado: u.estado, inicio_ocupacion: u.inicio_ocupacion }).eq('id_habitacion', u.id);
    }

    if (actualizaciones.length > 0) {
        await cargarHabitaciones();
        await cargarReservasActivas();
    }

    renderizarTodas();
    actualizarEstadisticas();
    iniciarContadores();
}

function renderizarTodas() {
    const grid = document.getElementById("grid-habitaciones");
    if (!grid) return;
    grid.innerHTML = "";
    habitaciones
        .slice()
        .sort((a, b) => a.numero - b.numero)
        .forEach(h => grid.appendChild(crearTarjeta(h)));
}

function crearTarjeta(hab) {
    const colorEstado = coloresEstados[hab.estado] || "disponible";
    const tieneTimer = hab.estado === "Ocupada" && !!hab.inicioOcupacion;

    const tarjeta = document.createElement("div");
    tarjeta.className = "tarjeta-habitacion";
    tarjeta.dataset.numero = hab.numero;
    tarjeta.dataset.estado = hab.estado;

    const reservaActiva = reservasActivas[hab.numero];
    const infoCliente = reservaActiva
        ? `<div class="cliente-info">👤 ${reservaActiva.clienteNombre.split(' ').slice(0,2).join(' ')}</div>`
        : '';

    const contadorHtml = tieneTimer
        ? `<div class="contador-timer" id="contador-${hab.numero}">⏱ --:--:--</div>`
        : '';

    // Botón de salida: solo aparece junto al temporizador cuando hay una reserva activa,
    // permite registrar automáticamente la hora de salida sin abrir el modal.
    const botonSalidaHtml = (tieneTimer && reservaActiva)
        ? `<button type="button" class="btn-salida-tarjeta" data-accion="salida" data-numero="${hab.numero}">🚪 Registrar salida</button>`
        : '';

    tarjeta.innerHTML = `
        <div class="numero-habitacion">${hab.numero}</div>
        <div class="icono-cama">${iconosPorTipo[hab.tipo] || "🛏️"}</div>
        <div class="tipo-habitacion">${hab.tipo}</div>
        ${infoCliente}
        <div class="estado-badge estado-${colorEstado}">
            <span class="punto-estado"></span>${hab.estado}
        </div>
        ${contadorHtml}
        ${botonSalidaHtml}
    `;

    tarjeta.addEventListener("click", () => abrirModalCambioEstado(hab.numero));

    const btnSalida = tarjeta.querySelector('[data-accion="salida"]');
    if (btnSalida) {
        btnSalida.addEventListener("click", (e) => {
            e.stopPropagation(); // evita abrir el modal de estado al hacer clic en el botón
            registrarSalida(hab.numero);
        });
    }

    return tarjeta;
}

function abrirModalCambioEstado(numero) {
    const modal = document.getElementById("modal-estado");
    document.getElementById("habitacion-numero-modal").textContent = numero;
    const opcionesDiv = document.getElementById("opciones-estado");
    opcionesDiv.innerHTML = "";

    const hab = obtenerHabitacionPorNumero(numero);
    const reservaActiva = reservasActivas[numero];

    if (hab && hab.estado === "Ocupada" && reservaActiva) {
        opcionesDiv.innerHTML = `
            <div class="caja-ocupada-info">
                <div style="font-size:1.5rem;margin-bottom:6px;">🔒</div>
                <strong>Habitación en uso activo</strong><br>
                <small>Cliente: ${reservaActiva.clienteNombre}</small><br>
                <small>Salida: se registra al presionar "Registrar salida"</small>
            </div>
        `;
        const btnSalida = document.createElement("button");
        btnSalida.type = "button";
        btnSalida.className = "btn-salida-modal";
        btnSalida.innerHTML = `🚪 Registrar Salida (Check-out)`;
        btnSalida.addEventListener("click", () => registrarSalida(numero));
        opcionesDiv.appendChild(btnSalida);
        modal.classList.add("activo");
        return;
    }

    // Si la habitación se puede reservar (no está ocupada ni en limpieza), mostramos
    // el botón de reserva destacado en la parte superior del modal.
    const puedeReservarse = hab && hab.estado !== "Ocupada" && hab.estado !== "Limpieza";
    if (puedeReservarse) {
        const btnReservar = document.createElement("button");
        btnReservar.type = "button";
        btnReservar.className = "btn-reservar-habitacion";
        btnReservar.innerHTML = `📅 Reservar esta habitación`;
        btnReservar.addEventListener("click", () => {
            cerrarModal();
            abrirModalReserva(numero);
        });
        opcionesDiv.appendChild(btnReservar);
    }

    const iconos = { "Disponible":"✓", "Ocupada":"⏱", "Limpieza":"🧹", "Mantenimiento":"⚙" };
    const gridEstados = document.createElement("div");
    gridEstados.className = "modal-opciones";
    gridEstados.style.margin = "0";
    estadosValidos.forEach(estado => {
        const btn = document.createElement("button");
        btn.className = `btn-opcion${hab && estado === hab.estado ? ' activo' : ''}`;
        btn.innerHTML = `<span class="opcion-icono">${iconos[estado]}</span>${estado}`;
        btn.addEventListener("click", () => cambiarEstado(numero, estado));
        gridEstados.appendChild(btn);
    });
    opcionesDiv.appendChild(gridEstados);

    modal.classList.add("activo");
}

function cerrarModal() { document.getElementById("modal-estado").classList.remove("activo"); }
function abrirModal() { window.location.href = 'reservas.html'; }
function abrirCheckout() { alert("Funcionalidad de Check-Out en construcción"); }
function volverPanel() { window.location.href = 'panel_control.html'; }

// ── MODAL DE RESERVA RÁPIDA ────────────────────────────────────

function pad(n) { return String(n).padStart(2, '0'); }
function fechaLocalInputValue(date) {
    return `${date.getFullYear()}-${pad(date.getMonth()+1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function abrirModalReserva(numero) {
    const modal = document.getElementById("modal-reserva");
    const form = document.getElementById("form-reserva-rapida");
    form.reset();

    // Habitación preseleccionada desde la tarjeta, o selección libre si viene del botón "Nueva Reserva"
    let hab = numero ? obtenerHabitacionPorNumero(numero) : null;
    if (!hab) {
        const disponibles = habitaciones.filter(h => h.estado === "Disponible" || h.estado === "Mantenimiento");
        if (disponibles.length === 0) { alert("No hay habitaciones disponibles para reservar en este momento."); return; }
        hab = disponibles[0];
    }

    document.getElementById("reserva-habitacion-numero").textContent = hab.numero;
    document.getElementById("reserva-habitacion-tipo").textContent = hab.tipo;
    document.getElementById("rr-numero-habitacion").value = hab.numero;
    document.getElementById("rr-id-habitacion").value = hab.id;
    document.getElementById("rr-precio-base").value = hab.precioBase ? hab.precioBase.toFixed(2) : "";

    // ID de reserva 100% automático, no editable por el usuario
    const idGenerado = generarIdReservaAutomatico();
    document.getElementById("rr-id-reserva").value = idGenerado;
    document.getElementById("rr-id-preview").textContent = idGenerado;

    // Fecha de entrada por defecto: ahora mismo
    const ahora = new Date();
    document.getElementById("rr-fecha-entrada").value = fechaLocalInputValue(ahora);
    document.getElementById("rr-bloques").value = "1";
    document.getElementById("rr-importe-total").value = "";

    poblarSelectClientesRapido();
    poblarSelectMetodoPagoRapido();
    limpiarBusquedaClienteRapido();

    modal.classList.add("activo");
    document.getElementById("rr-cliente-nombre").focus();
}

function cerrarModalReserva() {
    document.getElementById("modal-reserva").classList.remove("activo");
}

function calcularImporteReservaRapida() {
    // Los "bloques de 12h" ahora se ingresan directamente (estimado inicial),
    // ya que la fecha de salida real solo se conoce al presionar "Registrar salida".
    const precio = Number(document.getElementById("rr-precio-base").value);
    const bloques = Math.max(1, Math.floor(Number(document.getElementById("rr-bloques").value)) || 1);
    document.getElementById("rr-bloques").value = String(bloques);

    if (!precio) {
        document.getElementById("rr-importe-total").value = "";
        return 0;
    }

    const total = precio * bloques;
    document.getElementById("rr-importe-total").value = total.toFixed(2);
    return total;
}

function autocompletarClienteRapido() {
    const sel = document.getElementById("rr-cliente-registrado");
    const opt = sel.options[sel.selectedIndex];
    if (!sel.value) return;
    document.getElementById("rr-cliente-nombre").value = opt.dataset.nombre || "";
    document.getElementById("rr-cliente-dni").value = opt.dataset.dni || "";
    document.getElementById("rr-cliente-fecha-nac").value = opt.dataset.fechaNac || "";
    document.getElementById("rr-cliente-residencia").value = opt.dataset.residencia || "";
}

// ── BUSCADOR DE CLIENTE (por nombre o DNI) — reserva rápida ────

function textoClienteBuscadorRapido(c) {
    return `${c.apellidos_nombres} — DNI: ${c.dni}`;
}

function renderSugerenciasClientesRapido(filtro) {
    const lista = document.getElementById("rr-lista-clientes-sugeridos");
    if (!lista) return;
    const texto = filtro.trim().toLowerCase();

    if (!texto) { lista.style.display = "none"; lista.innerHTML = ""; return; }

    const coincidencias = clientesReserva.filter(c =>
        (c.apellidos_nombres || '').toLowerCase().includes(texto) ||
        String(c.dni || '').toLowerCase().includes(texto)
    ).slice(0, 8);

    lista.innerHTML = "";

    if (!coincidencias.length) {
        const vacio = document.createElement('div');
        vacio.className = 'item-sugerencia sin-resultado';
        vacio.textContent = 'Sin coincidencias — se registrará como cliente nuevo';
        lista.appendChild(vacio);
        lista.style.display = "block";
        return;
    }

    coincidencias.forEach(c => {
        const item = document.createElement('div');
        item.className = 'item-sugerencia';
        item.innerHTML = `
            <div class="item-sugerencia-info">
                <div class="item-sugerencia-nombre">${(c.apellidos_nombres || '').toUpperCase()}</div>
                <div class="item-sugerencia-dni"><span class="badge-dni-icono">🪪</span> DNI - ${c.dni}</div>
            </div>
            <button type="button" class="btn-agregar-cliente" aria-label="Seleccionar cliente">+</button>
        `;
        item.addEventListener('click', () => seleccionarClienteRapidoDesdeBusqueda(c));
        lista.appendChild(item);
    });
    lista.style.display = "block";
}

function seleccionarClienteRapidoDesdeBusqueda(c) {
    const sel = document.getElementById("rr-cliente-registrado");
    const info = document.getElementById("rr-cliente-seleccionado-info");
    const buscador = document.getElementById("rr-buscador-cliente");
    const lista = document.getElementById("rr-lista-clientes-sugeridos");

    if (sel) sel.value = c.id_cliente;
    autocompletarClienteRapido();
    if (buscador) buscador.value = textoClienteBuscadorRapido(c);
    if (info) info.innerHTML = `✅ <strong>${c.apellidos_nombres.toUpperCase()}</strong> — DNI ${c.dni}`;
    if (lista) { lista.style.display = "none"; lista.innerHTML = ""; }
}

function limpiarBusquedaClienteRapido() {
    const buscador = document.getElementById("rr-buscador-cliente");
    const info = document.getElementById("rr-cliente-seleccionado-info");
    const lista = document.getElementById("rr-lista-clientes-sugeridos");
    const sel = document.getElementById("rr-cliente-registrado");
    if (buscador) buscador.value = "";
    if (info) info.textContent = "";
    if (lista) { lista.style.display = "none"; lista.innerHTML = ""; }
    if (sel) sel.value = "";
}

async function guardarClienteRapido(datos) {
    const dni = String(datos.dni || '').trim();
    const existente = clientesReserva.find(c => String(c.dni).trim() === dni);
    if (existente) return { cliente: existente, creado: false };

    const nuevo = {
        id_cliente: `CLI-${Date.now().toString(36).toUpperCase()}`,
        apellidos_nombres: String(datos.nombre || '').trim(),
        fecha_nacimiento: datos.fechaNacimiento || null,
        dni,
        distrito_ciudad: String(datos.residencia || '').trim(),
        telefono: ''
    };

    const { error } = await supabaseClient.from('clientes').insert([nuevo]);
    if (error) throw error;

    clientesReserva.push(nuevo);
    return { cliente: nuevo, creado: true };
}

async function manejarSubmitReservaRapida(e) {
    e.preventDefault();

    const numeroHabitacion = document.getElementById("rr-numero-habitacion").value;
    const idHabitacion = document.getElementById("rr-id-habitacion").value;
    const nombre = document.getElementById("rr-cliente-nombre").value.trim();
    const dni = document.getElementById("rr-cliente-dni").value.trim();
    const fechaNacimiento = document.getElementById("rr-cliente-fecha-nac").value;
    const residencia = document.getElementById("rr-cliente-residencia").value.trim();
    const fechaEntrada = document.getElementById("rr-fecha-entrada").value;
    const metodoPago = document.getElementById("rr-metodo-pago").value;

    if (!nombre) { alert("Ingresa el nombre del cliente."); return; }
    if (!/^\d{8}$/.test(dni)) { alert("El DNI debe tener exactamente 8 dígitos."); return; }
    if (!fechaEntrada) { alert("Ingresa la fecha de entrada."); return; }
    if (!metodoPago) { alert("Selecciona un método de pago."); return; }

    const total = calcularImporteReservaRapida();
    if (!total) { alert("Revisa los bloques de 12h y la tarifa."); return; }

    const metodoSeleccionado = metodosPagoReserva.find(m => m.nombre === metodoPago);
    if (!metodoSeleccionado) { alert("Método de pago inválido."); return; }

    const btnSubmit = e.target.querySelector('button[type="submit"]');
    if (btnSubmit) btnSubmit.disabled = true;

    try {
        const resultado = await guardarClienteRapido({ nombre, dni, fechaNacimiento, residencia });

        const reservaId = document.getElementById("rr-id-reserva").value; // generado automáticamente al abrir el modal
        const bloquesReserva = Number(document.getElementById("rr-bloques").value) || 1;
        const entradaMs = new Date(fechaEntrada).getTime();
        const datosReserva = {
            reserva_id: reservaId,
            id_cliente: resultado.cliente.id_cliente,
            id_habitacion: idHabitacion,
            id_metodo_pago: metodoSeleccionado.id_metodo_pago,
            fecha_entrada: new Date(fechaEntrada).toISOString(),
            // Valor provisional: la base exige fecha_salida > fecha_entrada
            // (chk_reserva_fechas), así que se guarda entrada + bloques de 12h
            // hasta que el usuario presiona "Registrar salida", que lo reemplaza
            // por la hora real de salida.
            fecha_salida: new Date(entradaMs + bloquesReserva * 12 * 60 * 60 * 1000).toISOString(),
            precio_base: Number(document.getElementById("rr-precio-base").value),
            noches_estadia: bloquesReserva,
            importe_total: total,
            estado_habitacion: "Ocupada"
        };

        const { error: errorReserva } = await supabaseClient.from('reserva_habitacion').insert([datosReserva]);
        if (errorReserva) throw errorReserva;

        const { error: errorHabitacion } = await supabaseClient.from('habitaciones').update({
            estado: "Ocupada",
            inicio_ocupacion: new Date().toISOString()
        }).eq('id_habitacion', idHabitacion);
        if (errorHabitacion) throw errorHabitacion;

        cerrarModalReserva();
        await cargarHabitaciones();
        await cargarReservasActivas();
        renderizarTodas();
        actualizarEstadisticas();
        iniciarContadores();

        alert(`✅ Reserva ${reservaId} creada. La habitación ${numeroHabitacion} quedó Ocupada con temporizador activo.`);
    } catch (error) {
        const detalle = [error?.message, error?.details, error?.hint].filter(Boolean).join(' | ');
        manejarErrorSupabase(error, `No se pudo crear la reserva: ${detalle || error}`);
    } finally {
        if (btnSubmit) btnSubmit.disabled = false;
    }
}

// ── REGISTRO AUTOMÁTICO DE SALIDA (CHECK-OUT) ─────────────────

async function registrarSalida(numero) {
    const reservaActiva = reservasActivas[numero];
    const hab = obtenerHabitacionPorNumero(numero);
    if (!hab || !reservaActiva) { alert("Esta habitación no tiene una reserva activa."); return; }

    const ahora = new Date();
    const confirmar = confirm(`¿Registrar la salida de ${reservaActiva.clienteNombre} en la habitación ${numero}?\nHora de salida: ${ahora.toLocaleString('es-PE')}`);
    if (!confirmar) return;

    const ahoraIso = ahora.toISOString();

    const { error: errorReserva } = await supabaseClient
        .from('reserva_habitacion')
        .update({ fecha_salida: ahoraIso, estado_habitacion: 'Limpieza' })
        .eq('reserva_id', reservaActiva.reservaId);
    if (errorReserva) { manejarErrorSupabase(errorReserva, 'No se pudo registrar la salida.'); return; }

    const { error: errorHabitacion } = await supabaseClient
        .from('habitaciones')
        .update({ estado: 'Limpieza', inicio_ocupacion: null })
        .eq('id_habitacion', hab.id);
    if (errorHabitacion) { manejarErrorSupabase(errorHabitacion, 'No se pudo actualizar el estado de la habitación.'); return; }

    if (contadoresActivos[numero]) {
        clearInterval(contadoresActivos[numero]);
        delete contadoresActivos[numero];
    }

    cerrarModal();
    await cargarHabitaciones();
    await cargarReservasActivas();
    renderizarTodas();
    actualizarEstadisticas();

    alert(`🚪 Salida registrada. Habitación ${numero} pasó a estado Limpieza.`);
}

function actualizarEstadisticas() {
    const conteos = { "Disponible":0, "Ocupada":0, "Limpieza":0, "Mantenimiento":0 };
    habitaciones.forEach(h => {
        if (conteos.hasOwnProperty(h.estado)) conteos[h.estado]++;
    });

    const setTexto = (id, valor) => { const el = document.getElementById(id); if (el) el.textContent = valor; };
    setTexto("total-disponibles", conteos["Disponible"]);
    setTexto("total-ocupadas", conteos["Ocupada"]);
    setTexto("total-limpieza", conteos["Limpieza"]);
    setTexto("total-mantenimiento", conteos["Mantenimiento"]);
    setTexto("count-disponibles", conteos["Disponible"]);
    setTexto("count-ocupadas", conteos["Ocupada"]);
    setTexto("count-limpieza", conteos["Limpieza"]);
    setTexto("count-mantenimiento", conteos["Mantenimiento"]);
}

// ── EVENTOS DEL FORMULARIO DE RESERVA RÁPIDA ──────────────────

document.addEventListener("DOMContentLoaded", () => {
    const form = document.getElementById("form-reserva-rapida");
    if (form) form.addEventListener("submit", manejarSubmitReservaRapida);

    const btnCancelarReserva = document.getElementById("btn-cancelar-reserva");
    if (btnCancelarReserva) btnCancelarReserva.addEventListener("click", cerrarModalReserva);

    const selCliente = document.getElementById("rr-cliente-registrado");
    if (selCliente) selCliente.addEventListener("change", autocompletarClienteRapido);

    const buscadorClienteRapido = document.getElementById("rr-buscador-cliente");
    if (buscadorClienteRapido) {
        buscadorClienteRapido.addEventListener("input", () => {
            const sel = document.getElementById("rr-cliente-registrado");
            const info = document.getElementById("rr-cliente-seleccionado-info");
            if (sel && sel.value) {
                sel.value = "";
                if (info) info.textContent = "";
            }
            renderSugerenciasClientesRapido(buscadorClienteRapido.value);
        });
        buscadorClienteRapido.addEventListener("focus", () => renderSugerenciasClientesRapido(buscadorClienteRapido.value));
        document.addEventListener("click", (e) => {
            if (!e.target.closest("#modal-reserva .buscador-cliente-wrapper")) {
                const lista = document.getElementById("rr-lista-clientes-sugeridos");
                if (lista) lista.style.display = "none";
            }
        });
    }

    ["rr-precio-base", "rr-bloques"].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.addEventListener("input", calcularImporteReservaRapida);
        if (el) el.addEventListener("change", calcularImporteReservaRapida);
    });
});

document.addEventListener("click", (e) => {
    const modalEstado = document.getElementById("modal-estado");
    if (e.target === modalEstado) cerrarModal();

    const modalReserva = document.getElementById("modal-reserva");
    if (e.target === modalReserva) cerrarModalReserva();
});
document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") { cerrarModal(); cerrarModalReserva(); }
});
