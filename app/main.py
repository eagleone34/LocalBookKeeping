from __future__ import annotations

import sys
from datetime import datetime
from pathlib import Path

from PySide6 import QtWidgets

from app.db import connect_db, ensure_company, get_db_path, init_db, seed_sample_data
from app.services.data_service import DataService
from app.ui.main_window import MainWindow


def main() -> int:
    base_dir = Path(__file__).resolve().parent.parent / "company_data"
    base_dir.mkdir(parents=True, exist_ok=True)
    db_path = get_db_path(base_dir)
    connection = connect_db(db_path)
    init_db(connection)
    company_id = ensure_company(connection, "Demo Company", "USD", datetime.utcnow().isoformat())
    seed_sample_data(connection, company_id, datetime.utcnow().isoformat())
    data_service = DataService(connection, company_id)

    app = QtWidgets.QApplication(sys.argv)
    window = MainWindow(data_service, base_dir)
    window.show()
    return app.exec()


if __name__ == "__main__":
    raise SystemExit(main())
