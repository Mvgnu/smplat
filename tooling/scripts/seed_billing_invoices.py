"""Seed sample invoices for billing dashboard smoke tests."""

from __future__ import annotations

import argparse
import os
import sys
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from uuid import uuid4

from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session, sessionmaker

ROOT = os.path.dirname(os.path.dirname(__file__))
API_SRC = os.path.join(ROOT, "..", "apps", "api", "src")
if API_SRC not in sys.path:
    sys.path.append(API_SRC)

from smplat_api.models import Invoice, InvoiceLineItem  # noqa: E402
from smplat_api.models.customer_profile import CurrencyEnum  # noqa: E402
from smplat_api.models.invoice import InvoiceStatusEnum  # noqa: E402
from smplat_api.models.user import User, UserRoleEnum  # noqa: E402


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Seed billing invoices for dashboard demos")
    parser.add_argument("--workspace-email", default="client@example.com", help="Workspace owner email")
    parser.add_argument("--count", type=int, default=3, help="Number of invoices to generate")
    parser.add_argument(
        "--currency",
        default="EUR",
        choices=["EUR", "USD"],
        help="Invoice currency",
    )
    return parser.parse_args()


def _ensure_user(session: Session, email: str) -> User:
    stmt = select(User).where(User.email == email)
    user = session.execute(stmt).scalar_one_or_none()
    if user:
        return user

    user = User(id=uuid4(), email=email, role=UserRoleEnum.CLIENT)
    session.add(user)
    session.flush()
    return user


def _create_invoice(session: Session, user: User, index: int, currency: CurrencyEnum) -> Invoice:
    issued_at = datetime.now(timezone.utc) - timedelta(days=index * 14)
    due_at = issued_at + timedelta(days=14)
    subtotal = Decimal("400.00") + Decimal(index * 75)
    tax = subtotal * Decimal("0.2")
    total = subtotal + tax
    balance_due = total if index % 2 == 0 else Decimal("0.00")

    status = InvoiceStatusEnum.PAID if balance_due == 0 else InvoiceStatusEnum.ISSUED

    invoice = Invoice(
        workspace_id=user.id,
        invoice_number=f"INV-{issued_at:%Y%m%d}-{index:02d}",
        status=status,
        currency=currency,
        subtotal=subtotal,
        tax=tax,
        total=total,
        balance_due=balance_due,
        issued_at=issued_at,
        due_at=due_at,
        memo="Seeded invoice for billing demo",
    )

    line_item = InvoiceLineItem(
        description="Instagram growth campaign",
        quantity=Decimal("1"),
        unit_amount=total,
        total_amount=total,
        campaign_reference=f"Campaign {index + 1}",
    )
    invoice.line_items.append(line_item)
    session.add(invoice)
    return invoice


def main() -> None:
    args = _parse_args()
    database_url = os.environ.get("DATABASE_URL") or os.environ.get("DATABASE_URL_SYNC")
    if not database_url:
        raise SystemExit("DATABASE_URL is required to seed invoices")

    engine = create_engine(database_url)
    SessionLocal = sessionmaker(engine)

    with SessionLocal() as session:
        user = _ensure_user(session, args.workspace_email)
        currency = CurrencyEnum[args.currency]
        for index in range(args.count):
            _create_invoice(session, user, index, currency)
        session.commit()
        print(f"Seeded {args.count} invoices for {args.workspace_email}")


if __name__ == "__main__":
    main()
