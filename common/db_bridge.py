import json
import psycopg2
import psycopg2.extras

import os



db_host = "localhost"
db_user = os.environ.get("TERA_DB_USR")
db_pswrd = os.environ.get("TERA_DB_PSWRD")
db_name = "tera"

def _get_conn():
    return psycopg2.connect( host=db_host, 
                             user=db_user,
                             password=db_pswrd, 
                             dbname=db_name)


def execute_query(sql, params):
    exception = None
    response = None
    try:
        conn = _get_conn()
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        cur.execute(sql, params)
        response = cur.fetchall()
    except Exception as e:
        exception = e
        print(e)
    finally:
        try:
            cur.close()
            conn.close()
        except Exception:
            pass
    if (exception is not None):
        raise Exception from exception
        
    return response

def execute_intsert(sql, params):
    exception = None
    response = None
    sucess = False
    try:
        conn = _get_conn()
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        cur.execute(sql, params)
        conn.commit() 
        success = True
    except Exception as e:
        conn.rollback()
        exception = e
        print(e)
    finally:
        try:
            cur.close()
            conn.close()
        except Exception:
            pass
    if (exception is not None):
        raise Exception from exception
        
    return success