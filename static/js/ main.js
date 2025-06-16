function initApp(apiKey) {
    // --- ESTADO Y REFERENCIAS DEL DOM ---
    let map;
    let selectionMode = 'origen';
    let travelMode = 'car';
    const layers = { route: null, origenMarker: null, destinoMarker: null, tempMarkers: L.layerGroup() };
    const DOMElements = {
        origenInput: document.getElementById('origen'), destinoInput: document.getElementById('destino'),
        resultadoDiv: document.getElementById('resultado'), modeOrigenBtn: document.getElementById('mode-origen'),
        modeDestinoBtn: document.getElementById('mode-destino'), travelModeButtons: document.querySelectorAll('.travel-mode-buttons button'),
        calculateBtn: document.getElementById('calculate-btn'), resetBtn: document.getElementById('reset-btn'),
        avoidTollsCheck: document.getElementById('avoid-tolls'),
        avoidHighwaysCheck: document.getElementById('avoid-highways'),
        avoidUnpavedCheck: document.getElementById('avoid-unpaved'), // NUEVA REFERENCIA
    };

    // --- INICIALIZACIÓN ---
    function init() {
        L.mapquest.key = apiKey;
        map = L.mapquest.map('map', { center: [19.4326, -99.1332], layers: L.mapquest.tileLayer('map'), zoom: 12 });
        map.addControl(L.mapquest.control());
        layers.tempMarkers.addTo(map);
        addEventListeners();
    }

    function addEventListeners() {
        map.on('click', handleMapClick);
        DOMElements.modeOrigenBtn.addEventListener('click', () => setSelectionMode('origen'));
        DOMElements.modeDestinoBtn.addEventListener('click', () => setSelectionMode('destino'));
        DOMElements.travelModeButtons.forEach(btn => btn.addEventListener('click', () => setTravelMode(btn.dataset.mode)));
        DOMElements.calculateBtn.addEventListener('click', calculateRoute);
        DOMElements.resetBtn.addEventListener('click', resetApp);
    }

    // --- MANEJO DE ESTADO Y EVENTOS ---
    function setSelectionMode(mode) {
        selectionMode = mode;
        DOMElements.modeOrigenBtn.classList.toggle('active', mode === 'origen');
        DOMElements.modeDestinoBtn.classList.toggle('active', mode === 'destino');
    }

    function setTravelMode(mode) {
        travelMode = mode;
        DOMElements.travelModeButtons.forEach(btn => btn.classList.toggle('active', btn.dataset.mode === mode));
    }

    function handleMapClick(e) {
        const coords = `${e.latlng.lat.toFixed(6)},${e.latlng.lng.toFixed(6)}`;
        const input = (selectionMode === 'origen') ? DOMElements.origenInput : DOMElements.destinoInput;
        input.value = coords;
        L.marker(e.latlng, { icon: L.mapquest.icons.marker({ primaryColor: '#888888', size: 'sm' }) }).addTo(layers.tempMarkers);
    }
    
    async function calculateRoute() {
        const origen = DOMElements.origenInput.value.trim();
        const destino = DOMElements.destinoInput.value.trim();
        if (!origen || !destino) { showError("Por favor, ingresa un origen y un destino."); return; }

        clearRouteAndMarkers();
        showLoading("Calculando la mejor ruta...");

        const avoids = [];
        if (DOMElements.avoidTollsCheck.checked) avoids.push('toll road');
        if (DOMElements.avoidHighwaysCheck.checked) avoids.push('Limited Access');
        if (DOMElements.avoidUnpavedCheck.checked) avoids.push('unpaved'); // AÑADIDO: ENVIAR RESTRICCIÓN DE NO PAVIMENTADO

        try {
            const response = await fetch('/ruta', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ origen, destino, travelMode, avoids })
            });
            const data = await response.json();
            if (!response.ok) throw new Error(data.error);
            showResults(data);
            drawRoute(data);
        } catch (error) { showError(error.message || "No se pudo contactar al servidor."); }
    }
    
    function resetApp() {
        DOMElements.origenInput.value = ''; DOMElements.destinoInput.value = '';
        DOMElements.resultadoDiv.innerHTML = ''; DOMElements.avoidTollsCheck.checked = false;
        DOMElements.avoidHighwaysCheck.checked = false;
        DOMElements.avoidUnpavedCheck.checked = false; // AÑADIDO: REINICIAR CHECKBOX
        clearRouteAndMarkers();
        layers.tempMarkers.clearLayers(); map.setView([19.4326, -99.1332], 12);
    }
    
    // --- FUNCIONES DE RENDERIZADO Y MAPA ---
    function clearRouteAndMarkers() {
        if (layers.route) map.removeLayer(layers.route);
        if (layers.origenMarker) map.removeLayer(layers.origenMarker);
        if (layers.destinoMarker) map.removeLayer(layers.destinoMarker);
    }

    function drawRoute({ shape, start_lat_lng, end_lat_lng, travel_mode }) {
        layers.tempMarkers.clearLayers();
        const latLngs = shape.map((p, i) => (i % 2 === 0) ? [shape[i], shape[i+1]] : null).filter(Boolean);
        const colors = { car: '#4361ee', motorcycle: '#f72585', pedestrian: '#4cc9f0' };
        layers.route = L.polyline(latLngs, { color: colors[travel_mode], weight: 5, opacity: 0.8 }).addTo(map);
        map.fitBounds(layers.route.getBounds(), { padding: [40, 40] });
        layers.origenMarker = L.marker(start_lat_lng, { icon: L.mapquest.icons.marker({ primaryColor: '#4361ee', symbol: 'A' }) }).addTo(map);
        layers.destinoMarker = L.marker(end_lat_lng, { icon: L.mapquest.icons.marker({ primaryColor: '#f72585', symbol: 'B' }) }).addTo(map);
    }
    
    // --- FUNCIÓN DE RESULTADOS MEJORADA PARA MAYOR COHERENCIA ---
    function showResults(data) {
        const { travel_mode, applied_avoids, has_tolls, toll_distance_km, traffic_delay_minutes, costs, distance_km, time_minutes, directions } = data;

        // 1. Resumen de Opciones Aplicadas (para coherencia)
        const optionsSummaryHtml = buildOptionsSummary(travel_mode, applied_avoids, has_tolls, toll_distance_km);

        // 2. Resumen Principal de la Ruta
        const mainSummaryHtml = buildMainSummary(travel_mode, distance_km, time_minutes, traffic_delay_minutes, costs);

        // 3. Indicaciones
        const directionsHtml = directions.map((dir, i) => `<li><span>${i + 1}.</span><div>${dir}</div></li>`).join('');

        DOMElements.resultadoDiv.innerHTML = `
            ${optionsSummaryHtml}
            <div class="result-section">
                <h4><i class="fas fa-route"></i> Resumen de Ruta</h4>
                ${mainSummaryHtml}
            </div>
            <div class="result-section">
                <h4><i class="fas fa-list-ol"></i> Indicaciones</h4>
                <ol class="directions-list">${directionsHtml}</ol>
            </div>
            <div class="result-footer">Costos y tiempos son estimados.</div>
        `;
    }

    function buildOptionsSummary(travel_mode, applied_avoids, has_tolls, toll_distance_km) {
        const modeDetails = { car: 'Coche', motorcycle: 'Motocicleta', pedestrian: 'Peatonal' };
        let summaryList = `<li><i class="fas fa-check-circle"></i>Modo de viaje: <strong>${modeDetails[travel_mode]}</strong></li>`;
        
        if (applied_avoids.includes('toll road')) {
            summaryList += `<li><i class="fas fa-check-circle"></i>Se ha calculado una ruta <strong>evitando casetas</strong>.</li>`;
        } else if (has_tolls) {
            summaryList += `<li><i class="fas fa-check-circle"></i>Esta ruta <strong>incluye ${toll_distance_km} km</strong> de casetas.</li>`;
        } else {
            summaryList += `<li><i class="fas fa-check-circle"></i>Esta ruta <strong>no tiene casetas</strong>.</li>`;
        }

        if (applied_avoids.includes('Limited Access')) {
            summaryList += `<li><i class="fas fa-check-circle"></i>Se han <strong>evitado autopistas</strong>.</li>`;
        }

        if (applied_avoids.includes('unpaved')) { // AÑADIDO: MOSTRAR SI SE EVITARÁN NO PAVIMENTADAS
            summaryList += `<li><i class="fas fa-check-circle"></i>Se han <strong>evitado carreteras sin pavimentar</strong>.</li>`;
        }

        return `<div class="options-summary"><h5>Opciones Aplicadas</h5><ul>${summaryList}</ul></div>`;
    }

    function buildMainSummary(travel_mode, distance_km, time_minutes, traffic_delay_minutes, costs) {
        let trafficHtml = '';
        if (traffic_delay_minutes > 0) {
            trafficHtml = `<div class="traffic-warning"><i class="fas fa-traffic-light"></i> Se estima una demora de <strong>${traffic_delay_minutes} min</strong> por tráfico.</div>`;
        }

        let costsHtml = '';
        if (travel_mode !== 'pedestrian') {
            costsHtml = `
                <div class="result-item"><span>Consumo gasolina (est.):</span> <strong>${costs.consumo_litros} L</strong></div>
                <div class="result-item"><span>Costo gasolina (est.):</span> <strong>$${costs.gasolina_mxn.toFixed(2)} MXN</strong></div>
                <div class="result-item"><span>Costo casetas (est.):</span> <strong>$${costs.casetas_mxn.toFixed(2)} MXN</strong></div>
                <div class="result-item total"><span>Costo Total Viaje (est.):</span> <strong>$${costs.total_mxn.toFixed(2)} MXN</strong></div>
            `;
        }

        return `
            <div class="result-item"><span>Distancia:</span> <strong>${distance_km} km</strong></div>
            <div class="result-item"><span>Tiempo estimado:</span> <strong>${Math.round(time_minutes)} minutos</strong></div>
            ${trafficHtml}
            ${costsHtml}
        `;
    }

    function showLoading(message) {
        DOMElements.resultadoDiv.innerHTML = `<div class="loading-message"><div class="spinner"></div><span>${message}</span></div>`;
    }

    function showError(message) {
        DOMElements.resultadoDiv.innerHTML = `<div class="error-message"><i class="fas fa-exclamation-triangle"></i> <strong>Error:</strong> ${message}</div>`;
    }
    
    init(); // Iniciar la aplicación
}