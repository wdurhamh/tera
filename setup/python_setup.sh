#!/usr/bin/env bash

set -e

ENV_NAME=".tera"

echo "Checking for Python3..."
if ! command -v python3 &> /dev/null
then
    echo "Python3 not found. Installing..."
    sudo apt update
    sudo apt install -y python3 python3-venv python3-pip
fi

echo "Creating virtual environment: $ENV_NAME"
python3 -m venv $ENV_NAME

echo "Activating environment..."
source $ENV_NAME/bin/activate

echo "Upgrading pip..."
pip install --upgrade pip

echo "Installing system dependencies for GeoPandas..."
sudo apt install -y gdal-bin libgdal-dev libgeos-dev libproj-dev

echo "Installing Python packages..."
pip install geopandas sqlalchemy psycopg2-binary geoalchemy2

echo "Verifying installation..."
python -c "import geopandas; import sqlalchemy; import geoalchemy2; print('GeoPandas:', geopandas.__version__)"

echo "Installing Jupyter"
pip install jupyter

echo ""
echo "Done!"
echo "To activate later, run:"
echo "source $ENV_NAME/bin/activate"
