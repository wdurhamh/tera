
from openai import OpenAI
import json
import os, shutil, re
import time   
OPENAI_API_KEY = os.environ.get("OPENAI_API_KEY")

client = OpenAI(api_key=OPENAI_API_KEY)

RESPONSE_JSON_FORMAT = {
        "format": {
            "type": "json_schema",
            "name": "fish_observations",
            "schema": {
                "type": "object",
                "additionalProperties": False,
                "properties": {
                    "observations": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "additionalProperties": False,
                            "properties": {
                                "lake_name": {
                                    "type": "string"
                                },
                                "species": {
                                    "type": ["string", "null"]
                                },
                                "count": {
                                    "type": ["integer", "null"]
                                },
                                "length": {
                                    "type": ["integer", "null"]
                                },
                                "date": {
                                    "type": ["string", "null"]
                                },
                                "nearby_landmarks": {
                                    "type": "array",
                                    "items": {
                                        "type": "string"
                                    }
                                },
                                "notes": {
                                    "type": ["string", "null"]
                                }
                            },
                            "required": [
                                "lake_name",
                                "species",
                                "count",
                                "length",
                                "date",
                                "nearby_landmarks",
                                "notes"
                            ]
                        }
                    }
                },
                "required": ["observations"]
            }
        }
    }

class OpenAIBridge:
    def __init__(self, client, timeout = 2):
        #timeout in seconds
        self.client = client
        self.timeout = timeout
        self.time_at_last_call = 0
    
    def submit_prompt(self, prompt, model="gpt-4o-mini"):
        timeout_time = self.timeout - (time.time() - self.time_at_last_call) 
        if (timeout_time > 0):
            time.sleep(timeout_time)

        self.time_at_last_call = time.time()

        return self.client.responses.create(
        model=model,
        input=prompt,
        text=RESPONSE_JSON_FORMAT
    )

oai_bridge = OpenAIBridge(client)

def parse_trip_report(text: str, model:str = "gpt-4o-mini") -> list:
    prompt = f"""
    Extract structured fish observations from this trip report. There may be multiple fish observations.
    Return a single observation for every unique lake-species-date tuple. Only lake_name is required. To help
    identify lakes that share names with other lakes, also provide a list of nearby landmarks or other
    useful contextual informaiton that can be used to disambiguate between lakes with the same name.

    Return ONLY valid JSON with a list of objects of the following form:
    [{{lake_name: str, species: str, count: int/null, length: int/null, date: str, nearby_landmarks:[str], notes: str}}, ...]

    If you cannot find any valid observations, return an empty list. 

    Use the following abbreviations for species:
    - brook trout: bk
    - brown trout: br
    - rainbow trout: rt
    - cutthroat trout: ct
    - golden trout: gt

    For all other species, use the full name.

    Trip report:
    {text}
    """

    response = oai_bridge.submit_prompt(prompt, model=model)
    output_text = response.output[0].content[0].text
    print(output_text)
    observations = json.loads(output_text)["observations"]
    return observations

def process_report(report):
    text = report.get("text", "")
    #call to OpenAI to parse the text and extract observations
    observations = parse_trip_report(text)
    useful_observations = []
    for obs in observations:
        species = obs.get("species")
        if species is not None and species!= 'null':
            print(obs.get("species"))
            obs["source_url"] = report.get("source_url")
            obs["region_hint"] = report.get("region_hint")
            useful_observations.append(obs)
    return useful_observations

def process_batch_file(batch_file_path, output_file_path):
    with open(batch_file_path, "r") as f:
        reports = json.load(f)

    all_observations = []
    for report in reports:
        all_observations.extend(process_report(report))

    with open(output_file_path, "w") as f:
        json.dump(all_observations, f, indent=2)

if __name__ == "__main__":
    SOURCE_DIR = "./"
    PROCESSED_DIR = "./processed_posts"
    OUTPUT_DIR = "./parsed_observations"
    for filename in os.listdir(SOURCE_DIR):
        if filename.endswith(".json") and filename.startswith("hst_posts_"):
            batch_file_path = os.path.join(SOURCE_DIR, filename)
            output_file_path = os.path.join(OUTPUT_DIR, f"parsed_{filename}")
            process_batch_file(batch_file_path, output_file_path)
            #move processed batch file to an archive directory
            print("Processed file:", batch_file_path, "Output file:", output_file_path)
            shutil.move(batch_file_path, os.path.join(PROCESSED_DIR, filename))