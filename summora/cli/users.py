"""Invite/reset beta accounts locally; credentials are entered using getpass, never CLI arguments."""

import argparse
import getpass
import os

from summora.paths import DATA_DIR
from summora.storage import Store, password_hash

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("action", choices=["create", "reset", "revoke"])
    parser.add_argument("email")
    args = parser.parse_args()
    store = Store(os.environ.get("STUDIO_DATA_DIR", DATA_DIR))
    email = args.email.strip().lower()
    if args.action == "create":
        store.add_user(email, getpass.getpass("Mat khau (12-256 ky tu): "))
    else:
        new_hash = (
            password_hash(getpass.getpass("Mat khau moi: ")) if args.action == "reset" else None
        )
        with store.connection() as db:
            row = db.execute("SELECT id FROM users WHERE email=?", (email,)).fetchone()
            if not row:
                raise SystemExit("Khong tim thay tai khoan.")
            db.execute("DELETE FROM sessions WHERE user_id=?", (row[0],))
            if new_hash:
                db.execute("UPDATE users SET password=? WHERE id=?", (new_hash, row[0]))
            else:
                db.execute(
                    "UPDATE users SET password=? WHERE id=?",
                    (password_hash(os.urandom(32).hex()), row[0]),
                )
    print("Da cap nhat tai khoan.")
