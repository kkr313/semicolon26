"""
ClinDoc AI — Entry Point
Run:  python run.py
Open: http://localhost:8000
"""

import sys
import uvicorn
from backend.main import create_app
from backend.config import HOST, PORT

app = create_app()

if __name__ == "__main__":
    print(f"\n  ClinDoc AI running at  http://localhost:{PORT}\n")
    try:
        uvicorn.run(app, host=HOST, port=PORT)
    except KeyboardInterrupt:
        pass
    sys.exit(0)
