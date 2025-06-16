from flask import Flask, request, jsonify, render_template, url_for
import os
import requests
from dotenv import load_dotenv
import re

load_dotenv()

app = Flask(__name__)

# --- CONFIGURACIÓN CENTRALIZADA Y MÁS CLARA ---
CONFIG = {
    'MAPQUEST_KEY': os.getenv('MAPQUEST_KEY'),
    'COSTS': {
        'precio_gasolina_mxn_litro': 24.50,
        'costo_promedio_caseta_mxn_km': 3.50,
    },
    'VEHICLE_PERFORMANCE': {
        'car': {'rendimiento_promedio_km_l': 12},
        'motorcycle': {'rendimiento_promedio_km_l': 25},
    }
}

def validate_location_input(location_str):
    regex_coords = r"^\s*-?\d{1,3}(?:\.\d+)?\s*,\s*-?\d{1,3}(?:\.\d+)?\s*$"
    if re.match(regex_coords, location_str):
        try:
            lat_str, lng_str = location_str.replace(' ', '').split(',')
            lat = float(lat_str); lng = float(lng_str)
            if not (-90 <= lat <= 90 and -180 <= lng <= 180):
                return False, "Coordenadas fuera de rango."
            return True, None
        except ValueError: return False, "Formato de coordenada inválido."
    return True, None

def calculate_costs(distance_km, toll_distance_km, travel_mode):
    costs = {'gasolina_mxn': 0, 'casetas_mxn': 0, 'total_mxn': 0, 'consumo_litros': 0}
    costs['casetas_mxn'] = toll_distance_km * CONFIG['COSTS']['costo_promedio_caseta_mxn_km']
    if travel_mode in CONFIG['VEHICLE_PERFORMANCE']:
        performance = CONFIG['VEHICLE_PERFORMANCE'][travel_mode]
        consumo_litros = distance_km / performance['rendimiento_promedio_km_l']
        costs['consumo_litros'] = round(consumo_litros, 2)
        costs['gasolina_mxn'] = consumo_litros * CONFIG['COSTS']['precio_gasolina_mxn_litro']
    costs['total_mxn'] = costs['gasolina_mxn'] + costs['casetas_mxn']
    for key in costs: costs[key] = round(costs[key], 2)
    return costs

@app.route('/')
def index():
    if not CONFIG['MAPQUEST_KEY']:
        return "<h1>Error: La API Key de MapQuest no está configurada en el servidor.</h1>", 500
    return render_template('index.html', mapquest_key=CONFIG['MAPQUEST_KEY'])

@app.route('/ruta', methods=['POST'])
def calcular_ruta():
    try:
        data = request.get_json()
        origen, destino = data.get('origen', '').strip(), data.get('destino', '').strip()
        travel_mode, avoids_from_frontend = data.get('travelMode', 'car'), data.get('avoids', [])
        
        if not origen or not destino: return jsonify({'error': 'Se requieren origen y destino'}), 400
        is_valid, err = validate_location_input(origen); 
        if not is_valid: return jsonify({'error': f'Origen inválido: {err}'}), 400
        is_valid, err = validate_location_input(destino); 
        if not is_valid: return jsonify({'error': f'Destino inválido: {err}'}), 400

        # --- LÓGICA DE RUTA MEJORADA ---
        avoid_list = set(avoids_from_frontend)
        if travel_mode == 'motorcycle': avoid_list.add('Limited Access')
        
        # AÑADIR RESTRICCIÓN DE CARRETERAS SIN PAVIMENTAR
        if 'unpaved' in avoids_from_frontend:
            avoid_list.add('unpaved')

        params = {
            'key': CONFIG['MAPQUEST_KEY'], 'from': origen, 'to': destino,
            'outFormat': 'json', 'ambiguities': 'ignore', 'narrativeType': 'text',
            'fullShape': True, 'generalize': 0, 'unit': 'k', 'locale': 'es_MX',
            'routeType': 'pedestrian' if travel_mode == 'pedestrian' else 'fastest',
            'avoids': ','.join(avoid_list) if avoid_list else None
        }
        params = {k: v for k, v in params.items() if v is not None} # Eliminar claves nulas

        response = requests.get("https://www.mapquestapi.com/directions/v2/route", params=params, timeout=20)
        response_data = response.json()
        route = response_data.get('route')
        info = response_data.get('info', {})

        if response.status_code != 200 or info.get('statuscode') != 0 or not route:
            msg = info.get('messages', ['Error desconocido.'])[0]
            err_msg = "No se pudo encontrar una ruta. Verifica las ubicaciones y las restricciones." if "Cannot route from" in msg else msg
            return jsonify({'error': err_msg}), 400
        
        # --- NUEVA LÓGICA DE TIEMPO Y TRÁFICO ---
        # Prioriza el tiempo real (con tráfico) si está disponible y es mayor
        static_time = route.get('time', 0)
        real_time = route.get('realTime', 0)
        final_time = real_time if real_time > static_time else static_time
        traffic_delay_minutes = (real_time - static_time) / 60 if real_time > static_time else 0
        
        costs = calculate_costs(route.get('distance', 0), route.get('tollRoadDistance', 0), travel_mode)

        return jsonify({
            'directions': [m['narrative'] for m in route['legs'][0]['maneuvers']],
            'distance_km': round(route.get('distance', 0), 2),
            'time_minutes': round(final_time / 60, 1),
            'traffic_delay_minutes': round(traffic_delay_minutes),
            'toll_distance_km': round(route.get('tollRoadDistance', 0), 2),
            'has_tolls': route.get('hasTollRoad', False),
            'costs': costs,
            'shape': route['shape']['shapePoints'],
            'start_lat_lng': (route['locations'][0]['latLng']['lat'], route['locations'][0]['latLng']['lng']),
            'end_lat_lng': (route['locations'][1]['latLng']['lat'], route['locations'][1]['latLng']['lng']),
            'travel_mode': travel_mode,
            'applied_avoids': list(avoid_list)
        })

    except requests.exceptions.Timeout: return jsonify({'error': 'El servidor de rutas no respondió a tiempo.'}), 504
    except Exception as e: return jsonify({'error': f'Ocurrió un error inesperado: {str(e)}'}), 500

if __name__ == '__main__':
    app.run(debug=True, port=5000)