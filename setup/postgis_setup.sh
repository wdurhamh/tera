#!/usr/bin/env bash

set -e

if [ -z "$TERA_DB_PSWRD" ]; then
    echo "Error: DB_PASS environment variable is not set. Please set it before running this script."
    exit 1
fi

DB_NAME="tera"
DB_USER="${TERA_DB_USR}"
DB_PASS="${TERA_DB_PSWRD}"
PG_ADMIN="postgres"

echo "Updating package list..."
sudo apt update

echo "Installing PostgreSQL and PostGIS..."
sudo apt install -y postgresql postgresql-contrib postgis

echo "Starting and enabling PostgreSQL..."
sudo systemctl enable postgresql
sudo systemctl start postgresql

echo "Creating database user: $DB_USER"
sudo -u $PG_ADMIN psql -tc "SELECT 1 FROM pg_roles WHERE rolname='$DB_USER'" | grep -q 1 || \
sudo -u $PG_ADMIN psql -c "CREATE USER $DB_USER WITH PASSWORD '$DB_PASS';"

echo "Creating database: $DB_NAME"
sudo -u $PG_ADMIN psql -tc "SELECT 1 FROM pg_database WHERE datname = '$DB_NAME'" | grep -q 1 || \
sudo -u $PG_ADMIN createdb -O $DB_USER $DB_NAME

echo "Granting privileges on database..."
sudo -u $PG_ADMIN psql -c "ALTER DATABASE $DB_NAME OWNER TO $DB_USER;"

echo "Enabling PostGIS extensions..."
sudo -u $PG_ADMIN psql -d $DB_NAME -c "CREATE EXTENSION IF NOT EXISTS postgis;"
sudo -u $PG_ADMIN psql -d $DB_NAME -c "CREATE EXTENSION IF NOT EXISTS postgis_topology;"

echo "Verifying installation..."
sudo -u $PG_ADMIN psql -d $DB_NAME -c "SELECT PostGIS_Version();"

echo "Done!"
echo "Database: $DB_NAME"
echo "User: $DB_USER"
