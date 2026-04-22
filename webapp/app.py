from flask import Flask, jsonify, request, send_from_directory, abort
import os
import json
from flask_cors import CORS

import db_bridge

app = Flask(__name__, static_folder='static', static_url_path='')
CORS(app)


@app.route('/')
def index():
    return send_from_directory(app.static_folder, 'index.html')


@app.route('/api/lakes/count')
def api_lakes_count():
    """Return lakes as a GeoJSON FeatureCollection.

    Optional query params:
      - species: string
      - min_length: numeric (inches)
      - bbox: minx,miny,maxx,maxy (optional bounding box to limit results)
    """
    species = request.args.get('species')
    min_length = request.args.get('min_length')
    bbox = request.args.get('bbox')

    where_clauses = []
    params = []
    join = ''

    # observation filters require joining observations
    if species or min_length:
        join = 'JOIN observations o ON o.water_body_id = w.id'
        if species:
            where_clauses.append('o.species = %s')
            params.append(species)
        if min_length:
            where_clauses.append('o.length_max >= %s')
            params.append(float(min_length))

    # bbox spatial filter
    if bbox:
        try:
            minx, miny, maxx, maxy = map(float, bbox.split(','))
            where_clauses.append('ST_Intersects(w.nominal_coords, ST_MakeEnvelope(%s, %s, %s, %s, 4326))')
            params.extend([minx, miny, maxx, maxy])
        except Exception:
            abort(400, description='invalid bbox, expected minx,miny,maxx,maxy')

    where_clause = ('WHERE ' + ' AND '.join(where_clauses)) if where_clauses else ''

    sql = f"""
    SELECT DISTINCT w.* , ST_AsGeoJSON(w.nominal_coords) AS geom_json
    FROM water_bodies w
    {join}
    {where_clause}
    ORDER BY w.name
    """
    print(sql, params)
    try:
        rows = db_bridge.execute_query(sql, params)
    except Exception as e:
        app.logger.exception('DB error')
        abort(500, description=str(e))

    features = []
    for r in rows:
        geom = None
        if r.get('geom_json'):
            try:
                geom = json.loads(r['geom_json'])
            except Exception:
                geom = None

        # build properties excluding geometry
        props = dict(r)
        props.pop('geom_json', None)
        # remove binary/geometric objects that are not JSON serializable
        props.pop('geom', None)

        # Ensure id exists on properties for convenience
        props['id'] = props.get('id')

        feature = {
            'type': 'Feature',
            'geometry': geom,
            'properties': props
        }
        features.append(feature)

    fc = {'count': len(rows)}
    return jsonify(fc)

@app.route('/api/lakes')
def api_lakes():
    """Return lakes as a GeoJSON FeatureCollection.

    Optional query params:
      - species: string
      - min_length: numeric (inches)
      - bbox: minx,miny,maxx,maxy (optional bounding box to limit results)
    """
    species = request.args.get('species')
    min_length = request.args.get('min_length')
    bbox = request.args.get('bbox')

    where_clauses = []
    params = []
    join = ''

    # observation filters require joining observations
    if species or min_length:
        join = 'JOIN observations o ON o.water_body_id = w.id'
        if species:
            where_clauses.append('o.species = %s')
            params.append(species)
        if min_length:
            where_clauses.append('o.length_max >= %s')
            params.append(float(min_length))

    # bbox spatial filter
    if bbox:
        try:
            minx, miny, maxx, maxy = map(float, bbox.split(','))
            where_clauses.append('ST_Intersects(w.nominal_coords, ST_MakeEnvelope(%s, %s, %s, %s, 4326))')
            params.extend([minx, miny, maxx, maxy])
        except Exception:
            abort(400, description='invalid bbox, expected minx,miny,maxx,maxy')

    where_clause = ('WHERE ' + ' AND '.join(where_clauses)) if where_clauses else ''

    sql = f"""
    SELECT DISTINCT w.* , ST_AsGeoJSON(w.nominal_coords) AS geom_json
    FROM water_bodies w
    {join}
    {where_clause}
    ORDER BY w.name
    """

    try:
        rows = db_bridge.execute_query(sql, params)
    except Exception as e:
        app.logger.exception('DB error')
        abort(500, description=str(e))

    features = []
    for r in rows:
        geom = None
        if r.get('geom_json'):
            try:
                geom = json.loads(r['geom_json'])
            except Exception:
                geom = None

        # build properties excluding geometry
        props = dict(r)
        props.pop('geom_json', None)
        # remove binary/geometric objects that are not JSON serializable
        props.pop('geom', None)

        # Ensure id exists on properties for convenience
        props['id'] = props.get('id')

        feature = {
            'type': 'Feature',
            'geometry': geom,
            'properties': props
        }
        features.append(feature)

    fc = {'type': 'FeatureCollection', 'features': features}
    return jsonify(fc)


@app.route('/api/lakes/<int:water_body_id>/observations')
def api_lake_observations(water_body_id):
    sql = """
    SELECT 
    TO_CHAR(date, 'MM/DD/YYYY') as date_string,
    species,
    count,
    length_max,
    length_avg,
    length_min,
    type,
    source,
    notes,
    id
    FROM observations
    WHERE water_body_id = %s
    ORDER BY date DESC NULLS LAST
    """
    try:
        rows = db_bridge.execute_query(sql, (water_body_id,))
    except Exception as e:
        app.logger.exception('DB error')
        abort(500, description=str(e))
    
    # Convert any Decimal/date objects as strings via json.dumps trick
    return jsonify([dict(r) for r in rows])

@app.route('/api/observations/<int:observation_id>/remove')
def api_remove_observat(observation_id):
    sql_string = "DELETE FROM observations WHERE id=%s"

    try:
        db_bridge.execute_intsert(sql_string, (observation_id,))
    except Exception as e:
        app.logger.exception('DB error')
        abort(500, description=str(e))
    return jsonify({"success":1})

@app.route('/api/lakes/<int:water_body_id>/new_observation', methods=["POST"])
def api_new_observation(water_body_id):

    data = request.get_json()
    date = data.get('date')
    species = data.get('species')
    count = data.get('count')
    length_min = data.get('length_min')
    length_max = data.get('length_max')
    length_avg = data.get('length_avg')
    obs_type = data.get('type')
    source = data.get('source')
    notes = data.get('notes')

    sql_string = """INSERT INTO observations (
                    water_body_id,
                    species,
                    date,
                    count,
                    length_min,
                    length_max,
                    length_avg,
                    type,
                    source,
                    notes)
                    VALUES (
                    %s,
                    %s,
                    %s,
                    %s,
                    %s,
                    %s,
                    %s,
                    %s,
                    %s,
                    %s)
    
    """

    try:
        db_bridge.execute_intsert(sql_string,
                                (water_body_id,
                                species,
                                date,
                                count,
                                length_min,
                                length_max,
                                length_avg,
                                obs_type,
                                source,
                                notes))
    except Exception as e:
        app.logger.exception('DB error')
        abort(500, description=str(e))
    return jsonify({"success":1})


@app.route('/api/trails')
def api_trails():
    """Return trails as a GeoJSON FeatureCollection.
    
    Optional query params:
      - bbox: minx,miny,maxx,maxy (optional bounding box to limit results)
    """
    bbox = request.args.get('bbox')

    where_clauses = []
    params = []

    # bbox spatial filter
    if bbox:
        try:
            minx, miny, maxx, maxy = map(float, bbox.split(','))
            where_clauses.append('ST_Intersects(geometry, ST_MakeEnvelope(%s, %s, %s, %s, 4269))')
            params.extend([minx, miny, maxx, maxy])
        except Exception:
            abort(400, description='invalid bbox, expected minx,miny,maxx,maxy')

    where_clause = ('WHERE ' + ' AND '.join(where_clauses)) if where_clauses else ''

    sql = f"""
    SELECT name, trail_number, length, owner, state, source, id_in_source,
           ST_AsGeoJSON(geometry) AS geom_json
    FROM trails
    {where_clause}
    ORDER BY name
    """

    try:
        rows = db_bridge.execute_query(sql, params)
    except Exception as e:
        app.logger.exception('DB error')
        abort(500, description=str(e))

    features = []
    for r in rows:
        geom = None
        if r.get('geom_json'):
            try:
                geom = json.loads(r['geom_json'])
            except Exception:
                geom = None

        # build properties excluding geometry
        props = dict(r)
        props.pop('geom_json', None)

        feature = {
            'type': 'Feature',
            'geometry': geom,
            'properties': props
        }
        features.append(feature)

    fc = {'type': 'FeatureCollection', 'features': features}
    return jsonify(fc)


if __name__ == '__main__':
    # For development only. Use gunicorn/uwsgi in production.
    app.run(host='0.0.0.0', port=int(os.environ.get('PORT', 3000)), debug=True)

