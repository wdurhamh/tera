import os
import json

import sys
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '../..', 'common'))
import db_bridge

SIERRA_HINT = "sierra nevada"
SIERRA_BOUNDING_POLYGON_STR = """
POLYGON ((
-121.4925 40.6107634,
-122.1516797 40.2679384,
-121.5803906 39.3820169,
-121.0200879 38.3297435,
-119.8994824 37.3144109,
-118.9656445 36.3294439,
-118.778877 35.7520192,
-118.8118359 35.0265564,
-117.877998 34.9995623,
-117.6802441 36.1522259,
-118.745918 37.9841934,
-119.3721387 38.6050032,
-119.449043 39.2800422,
-119.9324414 40.0580414,
-120.9431836 40.6357795,
-121.4925 40.6107634))
"""
WINDS_HINT = "wind rivers"
WINDS_BOUNDING_POLYGON_STR = """
POLYGON((
-110.9 42.5,
-110.3 44.3,
-108.7 44.6,
-108.5 43.0,
-109.2 42.4,
-110.9 42.5
))
"""



def find_best_matching_water_body(lake_name, region_hint):
    #get the region hint
    #get the corresponding bounding box for the region
    sql = """ SELECT id, name FROM water_bodies
    WHERE name ILIKE %s AND ST_Within(nominal_coords, ST_GeomFromText(%s, 4326))""" 
    bounding_polygon_str = None
    if (region_hint == SIERRA_HINT):
        bounding_polygon_str = SIERRA_BOUNDING_POLYGON_STR
    elif (region_hint == WINDS_HINT):
        bounding_polygon_str = WINDS_BOUNDING_POLYGON_STR
    
    if (bounding_polygon_str is None):
        return None
    
    params = (f"%{lake_name}%", bounding_polygon_str)# 

    return db_bridge.execute_query(sql, params)

def map_observations_to_db(observations_file):
    with open(observations_file, "r") as f:
        observations = json.load(f)

    for obs in observations:
        water_body_id = find_best_matching_water_body(obs)
        if water_body_id:
            sql = """
            INSERT INTO observations (water_body_id, species, length_min, length_max, count_min, count_max, source_url, type )
            VALUES (%s, %s, %s, %s, %s, %s, %s. %s)
            """
            params = (
                water_body_id,
                obs.get("species"),
                obs.get("length_min"),
                obs.get("length_max"),
                obs.get("count_min"),
                obs.get("count_max"),
                obs.get("source_url"),
                obs.get("type")
            )
            db_bridge.execute_intsert(sql, params)


def collate_observations(directory, output_file):
    
    all_observations = []
    for filename in os.listdir(directory):
        if filename.endswith(".json"):
            with open(os.path.join(directory, filename), "r") as f:
                observations = json.load(f)
                all_observations.extend(observations)

    with open(output_file, "w") as f:
        json.dump(all_observations, f, indent=2)


if __name__ == "__main__":
    collate_observations("./parsed_observations", "collated_observations.json")