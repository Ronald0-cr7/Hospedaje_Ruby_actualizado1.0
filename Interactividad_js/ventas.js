document.addEventListener('DOMContentLoaded', () => {
    const ventaId = document.getElementById('venta-id');
    const ventaFecha = document.getElementById('venta-fecha');
    const ventaSinCliente = document.getElementById('venta-sin-cliente');
    const ventaCliente = document.getElementById('venta-cliente');
    const ventaBuscadorCliente = document.getElementById('venta-buscador-cliente');
    const ventaClienteSeleccionadoInfo = document.getElementById('venta-cliente-seleccionado-info');
    const ventaListaClientesSugeridos = document.getElementById('venta-lista-clientes-sugeridos');
    const ventaMetodoPago = document.getElementById('venta-metodo-pago');
    const ventaProducto = document.getElementById('venta-producto');
    const ventaCantidad = document.getElementById('venta-cantidad');
    const ventaPrecio = document.getElementById('venta-precio');
    const ventaSubtotal = document.getElementById('venta-subtotal');
    const ventaIgv = document.getElementById('venta-igv');
    const ventaTotal = document.getElementById('venta-total');
    const ventaSubtotalShow = document.getElementById('venta-subtotal-show');
    const ventaIgvShow = document.getElementById('venta-igv-show');
    const ventaTotalShow = document.getElementById('venta-total-show');
    const agregarDetalleBtn = document.getElementById('agregar-detalle-btn');
    const cancelarEdicionBtn = document.getElementById('cancelar-edicion-btn');
    const detalleVentaBody = document.getElementById('detalle-venta-body');
    const ventasBody = document.getElementById('ventas-body');
    const form = document.getElementById('venta-form');
    const fechaInicio = document.getElementById('fecha-inicio');
    const fechaFin = document.getElementById('fecha-fin');
    const btnFiltrar = document.getElementById('btn-filtrar');
    const btnLimpiar = document.getElementById('btn-limpiar');

    let clientes = [];
    let productos = [];
    let ventas = [];           // copia "plana" en memoria, leída de Supabase
    let carritoVenta = [];
    let ventaEditandoId = null; // venta_id (texto) cuando estamos editando
    const submitBtn = form.querySelector('button[type="submit"]');
    const UMBRAL_STOCK_BAJO = 5;

    function fechaAhoraLocal() {
        const now = new Date();
        const tzOffset = now.getTimezoneOffset() * 60000;
        return new Date(now - tzOffset).toISOString().slice(0, 16);
    }
    ventaFecha.value = fechaAhoraLocal();

    // ── CARGA DESDE SUPABASE ───────────────────────────────────

    async function cargarClientes() {
        const { data, error } = await supabaseClient
            .from('clientes')
            .select('id_cliente, apellidos_nombres, dni')
            .order('apellidos_nombres', { ascending: true });
        if (error) { manejarErrorSupabase(error, 'No se pudieron cargar los clientes.'); return; }
        clientes = data || [];
    }

    async function cargarProductosDb() {
        const { data, error } = await supabaseClient
            .from('productos')
            .select('id_producto, nombre_producto, precio_venta, stock, fecha_vencimiento')
            .order('nombre_producto', { ascending: true });
        if (error) { manejarErrorSupabase(error, 'No se pudieron cargar los productos.'); return; }
        productos = data || [];
    }

    async function cargarVentasDb() {
        const { data, error } = await supabaseClient
            .from('ventas')
            .select(`
                venta_id, fecha_hora_venta, id_cliente, cliente_nombre, subtotal, igv, total,
                metodo_pago:id_metodo_pago(nombre),
                detalle_venta(id_detalle, id_producto, producto_nombre, cantidad, precio_unitario, subtotal)
            `)
            .order('fecha_hora_venta', { ascending: false });
        if (error) { manejarErrorSupabase(error, 'No se pudieron cargar las ventas.'); return; }

        ventas = (data || []).map(v => ({
            ventaId: v.venta_id,
            fecha: v.fecha_hora_venta,
            clienteId: v.id_cliente,
            clienteNombre: v.cliente_nombre,
            metodoPago: v.metodo_pago?.nombre || 'EFECTIVO',
            detalles: (v.detalle_venta || []).map(d => ({
                productoId: d.id_producto,
                productoNombre: d.producto_nombre,
                cantidad: Number(d.cantidad),
                precioUnitario: Number(d.precio_unitario),
                subtotal: Number(d.subtotal)
            })),
            subtotal: Number(v.subtotal),
            igv: Number(v.igv),
            total: Number(v.total)
        }));
    }

    async function cargarTodo() {
        await Promise.all([cargarClientes(), cargarProductosDb(), cargarVentasDb()]);
        cargarProductosEnSelect();
        mostrarVentas();
    }

    // ── SELECTS ─────────────────────────────────────────────────

    function cargarProductosEnSelect() {
        ventaProducto.innerHTML = '<option value="">Seleccione un producto</option>';

        const hoy = new Date();
        hoy.setHours(0, 0, 0, 0);

        productos.forEach(p => {
            if (p.fecha_vencimiento) {
                const fechaVenc = new Date(`${p.fecha_vencimiento}T00:00:00`);
                fechaVenc.setHours(0, 0, 0, 0);
                if (fechaVenc <= hoy) return; // no mostrar vencidos
            }
            if (Number(p.stock) <= 0) return; // sin stock no se puede vender

            const opt = document.createElement('option');
            opt.value = p.id_producto;
            opt.dataset.precio = p.precio_venta;
            opt.dataset.nombre = p.nombre_producto;
            opt.dataset.stock = p.stock;
            const stockNum = Number(p.stock || 0);
            const etiquetaStock = stockNum <= UMBRAL_STOCK_BAJO
                ? `⚠ stock bajo: ${stockNum}`
                : `stock: ${stockNum}`;
            opt.textContent = `${p.nombre_producto} — S/ ${parseFloat(p.precio_venta).toFixed(2)} (${etiquetaStock})`;
            ventaProducto.appendChild(opt);
        });

    }

    function textoClienteBuscadorVenta(c) {
        return `${c.apellidos_nombres} — DNI: ${c.dni}`;
    }

    function renderSugerenciasClientesVenta(filtro) {
        if (!ventaListaClientesSugeridos) return;
        const texto = filtro.trim().toLowerCase();

        if (!texto) { ventaListaClientesSugeridos.style.display = "none"; ventaListaClientesSugeridos.innerHTML = ""; return; }

        const coincidencias = clientes.filter(c =>
            (c.apellidos_nombres || '').toLowerCase().includes(texto) ||
            String(c.dni || '').toLowerCase().includes(texto)
        ).slice(0, 8);

        ventaListaClientesSugeridos.innerHTML = "";

        if (!coincidencias.length) {
            const vacio = document.createElement('div');
            vacio.className = 'item-sugerencia sin-resultado';
            vacio.textContent = 'Sin coincidencias — verifica el nombre o DNI, o registra al cliente primero en el módulo Clientes';
            ventaListaClientesSugeridos.appendChild(vacio);
            ventaListaClientesSugeridos.style.display = "block";
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
            item.addEventListener('click', () => seleccionarClienteVentaDesdeBusqueda(c));
            ventaListaClientesSugeridos.appendChild(item);
        });
        ventaListaClientesSugeridos.style.display = "block";
    }

    function seleccionarClienteVentaDesdeBusqueda(c) {
        ventaCliente.value = c.id_cliente;
        if (ventaBuscadorCliente) ventaBuscadorCliente.value = textoClienteBuscadorVenta(c);
        if (ventaClienteSeleccionadoInfo) ventaClienteSeleccionadoInfo.innerHTML = `✅ <strong>${c.apellidos_nombres.toUpperCase()}</strong> — DNI ${c.dni}`;
        if (ventaListaClientesSugeridos) { ventaListaClientesSugeridos.style.display = "none"; ventaListaClientesSugeridos.innerHTML = ""; }
    }

    function limpiarBusquedaClienteVenta() {
        ventaCliente.value = "";
        if (ventaBuscadorCliente) ventaBuscadorCliente.value = "";
        if (ventaClienteSeleccionadoInfo) ventaClienteSeleccionadoInfo.textContent = "";
        if (ventaListaClientesSugeridos) { ventaListaClientesSugeridos.style.display = "none"; ventaListaClientesSugeridos.innerHTML = ""; }
    }

    if (ventaBuscadorCliente) {
        ventaBuscadorCliente.addEventListener("input", () => {
            // Si el usuario edita el texto tras haber elegido un cliente, se invalida la selección
            if (ventaCliente.value) {
                ventaCliente.value = "";
                if (ventaClienteSeleccionadoInfo) ventaClienteSeleccionadoInfo.textContent = "";
            }
            renderSugerenciasClientesVenta(ventaBuscadorCliente.value);
        });
        ventaBuscadorCliente.addEventListener("focus", () => renderSugerenciasClientesVenta(ventaBuscadorCliente.value));
        document.addEventListener("click", (e) => {
            if (!e.target.closest(".buscador-cliente-wrapper-venta")) {
                if (ventaListaClientesSugeridos) ventaListaClientesSugeridos.style.display = "none";
            }
        });
    }

    // ── CARRITO / DETALLE ────────────────────────────────────────

    function formatearFecha(fechaValor) {
        if (!fechaValor) return '-';
        return new Date(fechaValor).toLocaleString('es-PE');
    }

    function sumarSubtotalCarrito() {
        return carritoVenta.reduce((acumulado, detalle) => acumulado + detalle.subtotal, 0);
    }

    function actualizarResumenVenta() {
        const total = sumarSubtotalCarrito();
        const igv = total * 0.18;
        const subtotal = total - igv;

        ventaSubtotal.value = subtotal.toFixed(2);
        ventaIgv.value = igv.toFixed(2);
        ventaTotal.value = total.toFixed(2);
        if (ventaSubtotalShow) ventaSubtotalShow.textContent = `S/ ${subtotal.toFixed(2)}`;
        if (ventaIgvShow) ventaIgvShow.textContent = `S/ ${igv.toFixed(2)}`;
        if (ventaTotalShow) ventaTotalShow.textContent = `S/ ${total.toFixed(2)}`;

        return { subtotal, igv, total };
    }

    function renderizarDetalleVenta() {
        detalleVentaBody.innerHTML = '';

        if (carritoVenta.length === 0) {
            const filaVacia = document.createElement('tr');
            filaVacia.innerHTML = '<td colspan="5">No hay productos agregados todavía.</td>';
            detalleVentaBody.appendChild(filaVacia);
            actualizarResumenVenta();
            return;
        }

        carritoVenta.forEach((detalle, index) => {
            const fila = document.createElement('tr');
            fila.innerHTML = `
                <td>${detalle.productoNombre}</td>
                <td>${detalle.cantidad}</td>
                <td>S/ ${Number(detalle.precioUnitario).toFixed(2)}</td>
                <td>S/ ${Number(detalle.subtotal).toFixed(2)}</td>
                <td><button type="button" class="btn-eliminar-detalle">Quitar</button></td>
            `;
            fila.querySelector('.btn-eliminar-detalle').addEventListener('click', () => {
                carritoVenta.splice(index, 1);
                renderizarDetalleVenta();
            });
            detalleVentaBody.appendChild(fila);
        });

        actualizarResumenVenta();
    }

    function actualizarPrecioSeleccionado() {
        const seleccion = ventaProducto.selectedOptions[0];
        if (!seleccion || !seleccion.value) { ventaPrecio.value = ''; return; }
        ventaPrecio.value = Number(seleccion.dataset.precio || 0).toFixed(2);
    }

    function obtenerCantidadEnCarrito(productoId) {
        return carritoVenta
            .filter((detalle) => String(detalle.productoId) === String(productoId))
            .reduce((acumulado, detalle) => acumulado + Number(detalle.cantidad), 0);
    }

    function agregarDetalleAVenta() {
        const seleccion = ventaProducto.selectedOptions[0];
        if (!seleccion || !seleccion.value) { alert('Seleccione un producto'); return; }

        const productoId = seleccion.value;
        const productoNombre = seleccion.dataset.nombre;
        const precioUnitario = Number(seleccion.dataset.precio) || 0;
        const cantidad = Number(ventaCantidad.value) || 0;

        if (cantidad <= 0) { alert('La cantidad debe ser mayor a 0'); return; }

        const producto = productos.find((p) => String(p.id_producto) === String(productoId));
        if (!producto) { alert('El producto seleccionado ya no existe'); return; }

        const cantidadEnCarrito = obtenerCantidadEnCarrito(productoId);
        if ((cantidadEnCarrito + cantidad) > Number(producto.stock || 0)) {
            alert('Stock insuficiente para agregar esa cantidad');
            return;
        }

        const detalleExistente = carritoVenta.find((detalle) => String(detalle.productoId) === String(productoId));
        if (detalleExistente) {
            detalleExistente.cantidad += cantidad;
            detalleExistente.subtotal = detalleExistente.cantidad * detalleExistente.precioUnitario;
        } else {
            carritoVenta.push({ productoId, productoNombre, cantidad, precioUnitario, subtotal: cantidad * precioUnitario });
        }

        ventaCantidad.value = '1';
        renderizarDetalleVenta();
    }

    // ── TABLA DE VENTAS ──────────────────────────────────────────

    function mostrarVentas(listaVentas = ventas) {
        ventasBody.innerHTML = '';

        if (listaVentas.length === 0) {
            ventasBody.innerHTML = `<tr><td colspan="9">No hay ventas en ese rango de fechas</td></tr>`;
            return;
        }

        listaVentas.forEach((v) => {
            const tr = document.createElement('tr');
            const productosTexto = v.detalles.map((d) => `${d.productoNombre} x${d.cantidad}`).join(' | ');

            tr.innerHTML = `
                <td>${v.ventaId}</td>
                <td>${formatearFecha(v.fecha)}</td>
                <td>${v.clienteNombre || 'Venta sin cliente'}</td>
                <td>${v.metodoPago || 'EFECTIVO'}</td>
                <td>${productosTexto}</td>
                <td>${Number(v.subtotal).toFixed(2)}</td>
                <td>${Number(v.igv).toFixed(2)}</td>
                <td>${Number(v.total).toFixed(2)}</td>
                <td>
                    <button class="btn-editar-venta">✏️ Editar</button>
                    <button class="btn-eliminar-venta">🗑️ Eliminar</button>
                </td>
            `;

            tr.querySelector('.btn-editar-venta').addEventListener('click', () => {
                iniciarEdicionVenta(v.ventaId);
            });

            tr.querySelector('.btn-eliminar-venta').addEventListener('click', async () => {
                if (!confirm('¿Eliminar esta venta? El stock de los productos se restaurará automáticamente.')) return;
                // Al eliminar la venta (ON DELETE CASCADE en detalle_venta), el trigger
                // trg_stock_venta restaura el stock de cada producto automáticamente.
                const { error } = await supabaseClient.from('ventas').delete().eq('venta_id', v.ventaId);
                if (error) { manejarErrorSupabase(error, 'No se pudo eliminar la venta.'); return; }
                await cargarTodo();
            });

            ventasBody.appendChild(tr);
        });
    }

    // ── FILTRO POR FECHAS ────────────────────────────────────────

    function filtrarVentasPorFecha() {
        const inicio = fechaInicio.value;
        const fin = fechaFin.value;
        if (!inicio || !fin) { alert('Seleccione ambas fechas'); return; }

        const fechaInicioObj = new Date(inicio);
        const fechaFinObj = new Date(fin);
        fechaFinObj.setHours(23, 59, 59, 999);

        const ventasFiltradas = ventas.filter((venta) => {
            const fechaVenta = new Date(venta.fecha);
            return fechaVenta >= fechaInicioObj && fechaVenta <= fechaFinObj;
        });

        mostrarVentas(ventasFiltradas);
    }

    function limpiarFiltroVentas() {
        fechaInicio.value = '';
        fechaFin.value = '';
        mostrarVentas();
    }

    btnFiltrar.addEventListener('click', filtrarVentasPorFecha);
    btnLimpiar.addEventListener('click', limpiarFiltroVentas);

    // ── CLIENTE SELECCIONADO ─────────────────────────────────────

    function obtenerClienteSeleccionado() {
        if (ventaSinCliente.checked) {
            return { clienteId: null, clienteNombre: 'Venta sin cliente' };
        }

        if (!ventaCliente.value) throw new Error('Busca y selecciona un cliente (o marca "Registrar sin cliente").');

        const cliente = clientes.find((item) => item.id_cliente === ventaCliente.value);
        return {
            clienteId: ventaCliente.value,
            clienteNombre: cliente ? cliente.apellidos_nombres : ''
        };
    }

    function actualizarEstadoCliente() {
        const esSinCliente = ventaSinCliente.checked;
        if (ventaBuscadorCliente) ventaBuscadorCliente.disabled = esSinCliente;
        if (esSinCliente) limpiarBusquedaClienteVenta();
    }

    // ── EDICIÓN ───────────────────────────────────────────────────

    function cancelarEdicionVenta() {
        ventaEditandoId = null;
        carritoVenta = [];
        form.reset();
        limpiarBusquedaClienteVenta();
        if (ventaBuscadorCliente) ventaBuscadorCliente.disabled = false;
        ventaFecha.value = fechaAhoraLocal();
        submitBtn.textContent = 'Registrar Venta';
        cancelarEdicionBtn.classList.add('oculto');
        cargarProductosEnSelect();
        renderizarDetalleVenta();
    }

    function iniciarEdicionVenta(ventaIdSeleccionado) {
        const venta = ventas.find(v => v.ventaId === ventaIdSeleccionado);
        if (!venta) return;

        ventaEditandoId = venta.ventaId;
        ventaId.value = venta.ventaId;
        ventaFecha.value = venta.fecha ? new Date(venta.fecha).toISOString().slice(0, 16) : fechaAhoraLocal();
        ventaMetodoPago.value = venta.metodoPago;
        carritoVenta = venta.detalles.map(d => ({ ...d }));

        // El stock que se muestra en el select de productos ya refleja lo
        // que está vendido (porque el trigger lo descontó). Al guardar los
        // cambios, primero se eliminan los detalles antiguos (lo que repone
        // el stock) y luego se insertan los nuevos.
        if (venta.clienteId) {
            ventaSinCliente.checked = false;
            const cliente = clientes.find(c => c.id_cliente === venta.clienteId);
            if (cliente) {
                seleccionarClienteVentaDesdeBusqueda(cliente);
            } else {
                ventaCliente.value = venta.clienteId;
                if (ventaBuscadorCliente) ventaBuscadorCliente.value = venta.clienteNombre || '';
            }
        } else {
            ventaSinCliente.checked = true;
        }
        actualizarEstadoCliente();

        submitBtn.textContent = 'Guardar Cambios';
        cancelarEdicionBtn.classList.remove('oculto');
        renderizarDetalleVenta();
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    // ── EVENTOS ───────────────────────────────────────────────────

    ventaProducto.addEventListener('change', actualizarPrecioSeleccionado);
    ventaSinCliente.addEventListener('change', actualizarEstadoCliente);
    agregarDetalleBtn.addEventListener('click', agregarDetalleAVenta);
    cancelarEdicionBtn.addEventListener('click', cancelarEdicionVenta);

    form.addEventListener('submit', async (e) => {
        e.preventDefault();

        if (carritoVenta.length === 0) { alert('Agrega al menos un producto al detalle de venta.'); return; }

        const vId = ventaId.value.trim();
        if (!vId) { alert('Ingrese ID de venta'); return; }

        const existente = ventas.find((venta) => venta.ventaId === vId);
        if (existente && existente.ventaId !== ventaEditandoId) { alert('ID de venta ya existe'); return; }

        let clienteSeleccionado;
        try {
            clienteSeleccionado = obtenerClienteSeleccionado();
        } catch (error) {
            alert(error.message);
            return;
        }

        const resumen = actualizarResumenVenta();
        const detalles = carritoVenta.map(d => ({ ...d }));

        // Buscar id_metodo_pago a partir del nombre seleccionado
        const { data: metodoData, error: errorMetodo } = await supabaseClient
            .from('metodo_pago').select('id_metodo_pago').eq('nombre', ventaMetodoPago.value).maybeSingle();
        if (errorMetodo || !metodoData) { manejarErrorSupabase(errorMetodo, 'Método de pago inválido.'); return; }

        submitBtn.disabled = true;
        try {
            if (ventaEditandoId) {
                // 1) Eliminar detalles antiguos (el trigger repone el stock)
                const { error: errBorrarDetalle } = await supabaseClient.from('detalle_venta').delete().eq('venta_id', ventaEditandoId);
                if (errBorrarDetalle) throw errBorrarDetalle;

                // 2) Actualizar cabecera de la venta
                const { error: errUpdateVenta } = await supabaseClient.from('ventas').update({
                    id_cliente: clienteSeleccionado.clienteId,
                    cliente_nombre: clienteSeleccionado.clienteNombre,
                    id_metodo_pago: metodoData.id_metodo_pago,
                    fecha_hora_venta: new Date(ventaFecha.value).toISOString(),
                    subtotal: resumen.subtotal,
                    igv: resumen.igv,
                    total: resumen.total
                }).eq('venta_id', ventaEditandoId);
                if (errUpdateVenta) throw errUpdateVenta;

                // 3) Insertar nuevos detalles (el trigger descuenta el stock)
                const filasDetalle = detalles.map(d => ({
                    venta_id: ventaEditandoId,
                    id_producto: d.productoId,
                    producto_nombre: d.productoNombre,
                    cantidad: d.cantidad,
                    precio_unitario: d.precioUnitario,
                    subtotal: d.subtotal
                }));
                const { error: errInsertDetalle } = await supabaseClient.from('detalle_venta').insert(filasDetalle);
                if (errInsertDetalle) throw errInsertDetalle;
            } else {
                const { error: errInsertVenta } = await supabaseClient.from('ventas').insert([{
                    venta_id: vId,
                    id_cliente: clienteSeleccionado.clienteId,
                    cliente_nombre: clienteSeleccionado.clienteNombre,
                    id_metodo_pago: metodoData.id_metodo_pago,
                    fecha_hora_venta: new Date(ventaFecha.value).toISOString(),
                    subtotal: resumen.subtotal,
                    igv: resumen.igv,
                    total: resumen.total
                }]);
                if (errInsertVenta) throw errInsertVenta;

                const filasDetalle = detalles.map(d => ({
                    venta_id: vId,
                    id_producto: d.productoId,
                    producto_nombre: d.productoNombre,
                    cantidad: d.cantidad,
                    precio_unitario: d.precioUnitario,
                    subtotal: d.subtotal
                }));
                const { error: errInsertDetalle } = await supabaseClient.from('detalle_venta').insert(filasDetalle);
                if (errInsertDetalle) throw errInsertDetalle;
            }

            carritoVenta = [];
            form.reset();
            ventaFecha.value = fechaAhoraLocal();
            ventaPrecio.value = '';
            ventaSubtotal.value = '0.00';
            ventaIgv.value = '0.00';
            ventaTotal.value = '0.00';
            ventaMetodoPago.value = 'EFECTIVO';
            ventaSinCliente.checked = false;
            ventaEditandoId = null;
            submitBtn.textContent = 'Registrar Venta';
            cancelarEdicionBtn.classList.add('oculto');
            actualizarEstadoCliente();

            await cargarTodo();
            renderizarDetalleVenta();
        } catch (error) {
            manejarErrorSupabase(error, 'No se pudo registrar la venta (verifica el stock disponible).');
        } finally {
            submitBtn.disabled = false;
        }
    });

    // ── EXPORTAR EXCEL ────────────────────────────────────────────

    function exportVentasExcel() {
        if (typeof XLSX === 'undefined') { alert('No se pudo cargar la libreria de Excel.'); return; }

        const filasExcel = ventas.map(v => ({
            ID_Venta: v.ventaId,
            Fecha: v.fecha,
            Cliente: v.clienteNombre || 'Venta sin cliente',
            MetodoPago: v.metodoPago || 'EFECTIVO',
            Productos: v.detalles.map((detalle) => `${detalle.productoNombre} x${detalle.cantidad}`).join(' | '),
            Subtotal: Number(v.subtotal).toFixed(2),
            IGV: Number(v.igv).toFixed(2),
            Total: Number(v.total).toFixed(2)
        }));

        const wb = XLSX.utils.book_new();
        const ws = XLSX.utils.json_to_sheet(filasExcel);
        XLSX.utils.book_append_sheet(wb, ws, 'Ventas');
        XLSX.writeFile(wb, 'ventas.xlsx');
    }

    const exportBtn = document.getElementById('export-ventas-btn');
    if (exportBtn) exportBtn.addEventListener('click', exportVentasExcel);

    // ── RESUMEN DE MÉTODOS Y KPIs (se recalculan tras cada carga) ─

    function actualizarResumenMetodos() {
        const container = document.getElementById('resumen-metodos-ventas');
        if (!container) return;
        const resumen = ventas.reduce((acc, v) => {
            const m = v.metodoPago || 'EFECTIVO';
            acc[m] = (acc[m] || 0) + Number(v.total || 0);
            return acc;
        }, {});
        const iconos = { 'EFECTIVO': '💵', 'Yape/ARI': '📱', 'Visa/ARI': '💳', 'Yape E': '📲' };
        container.innerHTML = Object.entries(resumen).map(([m, t]) =>
            `<div class="metodo-card"><strong>${iconos[m] || '💰'} ${m}</strong><span>S/ ${t.toFixed(2)}</span></div>`
        ).join('') || '<p style="color:#94a3b8;font-size:.85rem">Sin ventas registradas</p>';
    }

    function actualizarKPIsVentas() {
        const total = ventas.reduce((s, v) => s + Number(v.total || 0), 0);
        const hoy = new Date().toLocaleDateString('es-PE');
        const hoyTotal = ventas.filter(v => new Date(v.fecha).toLocaleDateString('es-PE') === hoy)
            .reduce((s, v) => s + Number(v.total || 0), 0);
        const kpiTotal = document.getElementById('kpi-total-ventas');
        const kpiN = document.getElementById('kpi-n-ventas');
        const kpiHoy = document.getElementById('kpi-hoy');
        if (kpiTotal) kpiTotal.textContent = `S/ ${total.toFixed(2)}`;
        if (kpiN) kpiN.textContent = ventas.length;
        if (kpiHoy) kpiHoy.textContent = `S/ ${hoyTotal.toFixed(2)}`;
    }

    // Filtro por método de pago en tabla
    const filtroMetodo = document.getElementById('filtro-metodo');
    if (filtroMetodo) {
        filtroMetodo.addEventListener('change', () => {
            const metodo = filtroMetodo.value;
            document.querySelectorAll('#ventas-body tr').forEach(tr => {
                if (!metodo) { tr.style.display = ''; return; }
                const celdaMetodo = tr.cells[3];
                if (celdaMetodo) tr.style.display = celdaMetodo.textContent.includes(metodo) ? '' : 'none';
            });
        });
    }

    // Re-render con KPIs cada vez que se recarguen las ventas
    const _cargarTodoOriginal = cargarTodo;
    async function cargarTodoConKpis() {
        await _cargarTodoOriginal();
        actualizarResumenMetodos();
        actualizarKPIsVentas();
    }

    // ── INIT ──────────────────────────────────────────────────────
    actualizarEstadoCliente();
    renderizarDetalleVenta();
    cargarTodoConKpis();
});
