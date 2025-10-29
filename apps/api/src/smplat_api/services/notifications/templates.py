"""Notification templates for transactional events."""

from __future__ import annotations

import html
from dataclasses import dataclass
from datetime import datetime
from decimal import Decimal
from typing import Iterable, Sequence

from smplat_api.models.fulfillment import FulfillmentTask
from smplat_api.models.invoice import Invoice
from smplat_api.models.loyalty import LoyaltyMember, LoyaltyTier
from smplat_api.models.order import Order
from smplat_api.models.payment import Payment
from smplat_api.models.user import User


@dataclass
class RenderedTemplate:
    subject: str
    text_body: str
    html_body: str


def _format_currency(amount: Decimal, currency: str) -> str:
    symbols = {
        "EUR": "€",
        "USD": "$",
        "GBP": "£",
    }
    symbol = symbols.get(currency.upper(), "")
    numeric = f"{float(amount):.2f}"
    return f"{symbol}{numeric}" if symbol else f"{numeric} {currency.upper()}"


def render_payment_success(order: Order, payment: Payment, contact_name: str | None) -> RenderedTemplate:
    amount = payment.amount if isinstance(payment.amount, Decimal) else Decimal(payment.amount)
    currency = payment.currency.value if hasattr(payment.currency, "value") else str(payment.currency)
    formatted_amount = _format_currency(amount, currency)
    subject = f"Payment received for order {order.order_number}"
    greeting = f"Hi {contact_name}," if contact_name else "Hi there,"

    text_lines = [
        greeting,
        "",
        f"We received your payment of {formatted_amount} for order {order.order_number}.",
        "Our fulfillment team is preparing the next steps.",
        "",
        "What to expect next:",
        "- We will start fulfillment tasks within the next business day.",
        "- You can track progress in the SMPLAT dashboard.",
        "",
        "Thanks for partnering with SMPLAT.",
        "The SMPLAT Team",
    ]
    text_body = "\n".join(text_lines)

    html_body = f"""<html>
  <body>
    <p>{greeting}</p>
    <p>We received your payment of <strong>{formatted_amount}</strong> for order <strong>{order.order_number}</strong>.</p>
    <p>Our fulfillment team is preparing the next steps.</p>
    <h3>What to expect next</h3>
    <ul>
      <li>Fulfillment tasks begin within the next business day.</li>
      <li>Track progress anytime in the SMPLAT dashboard.</li>
    </ul>
    <p>Thanks for partnering with SMPLAT.</p>
    <p>The SMPLAT Team</p>
  </body>
</html>"""

    return RenderedTemplate(subject=subject, text_body=text_body, html_body=html_body)


def render_fulfillment_retry(
    order: Order,
    task: FulfillmentTask,
    *,
    contact_name: str | None,
    retry_count: int,
    max_retries: int,
    next_run_at: datetime | None,
) -> RenderedTemplate:
    subject = f"Retry scheduled for {task.title} on order {order.order_number}"
    greeting = f"Hi {contact_name}," if contact_name else "Hi there,"
    retry_phrase = f"{retry_count}/{max_retries}" if max_retries else str(retry_count)
    next_window = next_run_at.isoformat() if next_run_at else "shortly"

    text_lines = [
        greeting,
        "",
        f"We hit a snag running '{task.title}' ({task.task_type.value.replace('_', ' ')}) ",
        f"for order {order.order_number}. The task is queued for retry ({retry_phrase}).",
    ]
    if task.error_message:
        text_lines.extend(["", f"Latest error:", task.error_message])
    text_lines.extend(
        [
            "",
            f"New scheduled window: {next_window}",
            "",
            "We'll keep retrying automatically and alert you if manual action is needed.",
            "You can monitor task status in the dashboard.",
            "",
            "Thanks,",
            "The SMPLAT Team",
        ]
    )
    text_body = "\n".join(text_lines)

    html_body = f"""<html>
  <body>
    <p>{greeting}</p>
    <p>We hit a snag running <strong>{task.title}</strong> ({task.task_type.value.replace('_', ' ')}) for order <strong>{order.order_number}</strong>.</p>
    <p>The task is queued for retry <strong>({retry_phrase})</strong>.</p>"""
    if task.error_message:
        html_body += f"""
    <p><strong>Latest error:</strong><br />{task.error_message}</p>"""
    html_body += f"""
    <p><strong>New scheduled window:</strong> {next_window}</p>
    <p>We'll keep retrying automatically and alert you if manual action is needed. You can monitor task status in the dashboard.</p>
    <p>Thanks,<br />The SMPLAT Team</p>
  </body>
</html>"""

    return RenderedTemplate(subject=subject, text_body=text_body, html_body=html_body)


def render_fulfillment_completion(
    order: Order,
    *,
    contact_name: str | None,
    completed_tasks: Sequence[FulfillmentTask],
) -> RenderedTemplate:
    subject = f"Fulfillment completed for order {order.order_number}"
    greeting = f"Hi {contact_name}," if contact_name else "Hi there,"
    text_lines = [
        greeting,
        "",
        f"All fulfillment tasks for order {order.order_number} are complete.",
        "",
        "Highlights:",
    ]
    for task in completed_tasks:
        status_label = task.status.value.replace("_", " ")
        text_lines.append(f"- {task.title} ({status_label})")
    text_lines.extend(
        [
            "",
            "Next steps:",
            "- Review deliverables in the dashboard.",
            "- Share feedback or approvals directly from the order timeline.",
            "",
            "Appreciate you trusting SMPLAT.",
            "The SMPLAT Team",
        ]
    )
    text_body = "\n".join(text_lines)

    task_items = "".join(
        f"<li><strong>{task.title}</strong> ({task.status.value.replace('_', ' ')})</li>"
        for task in completed_tasks
    )
    html_body = f"""<html>
  <body>
    <p>{greeting}</p>
    <p>All fulfillment tasks for order <strong>{order.order_number}</strong> are complete.</p>
    <h3>Highlights</h3>
    <ul>
      {task_items}
    </ul>
    <h3>Next steps</h3>
    <ul>
      <li>Review deliverables in the dashboard.</li>
      <li>Share feedback or approvals directly from the order timeline.</li>
    </ul>
    <p>Appreciate you trusting SMPLAT.</p>
    <p>The SMPLAT Team</p>
  </body>
</html>"""

    return RenderedTemplate(subject=subject, text_body=text_body, html_body=html_body)


def render_weekly_digest(
    user: User,
    *,
    highlighted_orders: Iterable[Order],
    pending_actions: Sequence[str],
) -> RenderedTemplate:
    greeting = f"Hi {user.display_name}," if user.display_name else "Hi there,"
    subject = "Your SMPLAT weekly digest"

    text_lines = [
        greeting,
        "",
        "Here's your weekly summary from SMPLAT.",
        "",
        "Orders in focus:",
    ]
    for order in highlighted_orders:
        status = order.status.value.replace("_", " ") if order.status else "unknown"
        text_lines.append(f"- {order.order_number}: {status}")
    if not highlighted_orders:
        text_lines.append("- No active orders this week.")

    if pending_actions:
        text_lines.extend(["", "Pending actions:"])
        for item in pending_actions:
            text_lines.append(f"- {item}")

    text_lines.extend(
        [
            "",
            "Visit the dashboard for deeper analytics.",
            "",
            "See you next week,",
            "The SMPLAT Team",
        ]
    )
    text_body = "\n".join(text_lines)

    order_items = "".join(
        f"<li><strong>{order.order_number}</strong>: {order.status.value.replace('_', ' ') if order.status else 'unknown'}</li>"
        for order in highlighted_orders
    ) or "<li>No active orders this week.</li>"
    pending_items = "".join(f"<li>{item}</li>" for item in pending_actions)
    pending_section = (
        f"""
    <h3>Pending actions</h3>
    <ul>
      {pending_items}
    </ul>"""
        if pending_actions
        else ""
    )
    html_body = f"""<html>
  <body>
    <p>{greeting}</p>
    <p>Here's your weekly summary from SMPLAT.</p>
    <h3>Orders in focus</h3>
    <ul>
      {order_items}
    </ul>{pending_section}
    <p>Visit the dashboard for deeper analytics.</p>
    <p>See you next week,<br />The SMPLAT Team</p>
  </body>
</html>"""

    return RenderedTemplate(subject=subject, text_body=text_body, html_body=html_body)


def render_onboarding_concierge_nudge(
    order: Order,
    *,
    contact_name: str | None,
    subject: str,
    message_text: str,
) -> RenderedTemplate:
    """Render manual or automated onboarding concierge nudges."""

    greeting = f"Hi {contact_name}," if contact_name else "Hi there,"
    text_body = f"{greeting}\n\n{message_text}\n\nWe're standing by if you need anything.\nThe SMPLAT Team"

    paragraphs = [greeting] + message_text.split("\n\n") + ["We're standing by if you need anything.", "The SMPLAT Team"]
    html_paragraphs = "".join(f"<p>{html.escape(paragraph)}</p>" for paragraph in paragraphs if paragraph)
    html_body = f"""<html>
  <body>
    {html_paragraphs}
    <p><small>Order {html.escape(order.order_number)}</small></p>
  </body>
</html>"""

    return RenderedTemplate(subject=subject, text_body=text_body, html_body=html_body)


def render_invoice_overdue(invoice: Invoice, contact_name: str | None) -> RenderedTemplate:
    """Render an overdue invoice reminder."""

    balance = invoice.balance_due if invoice.balance_due is not None else invoice.total
    balance_decimal = balance if isinstance(balance, Decimal) else Decimal(balance)
    currency = invoice.currency.value if hasattr(invoice.currency, "value") else str(invoice.currency)
    formatted_balance = _format_currency(balance_decimal, currency)
    due_date = invoice.due_at.strftime("%B %d, %Y") if invoice.due_at else "soon"

    subject = f"Invoice {invoice.invoice_number} is overdue"
    greeting = f"Hi {contact_name}," if contact_name else "Hi there,"

    text_lines = [
        greeting,
        "",
        f"A quick reminder that invoice {invoice.invoice_number} is overdue.",
        f"Balance due: {formatted_balance} (originally due {due_date}).",
        "",
        "Next steps:",
        "- Review the invoice in the SMPLAT billing center.",
        "- Pay online or reach out if you need a revised schedule.",
        "",
        "We're here to help if you have questions.",
        "The SMPLAT Finance Team",
    ]
    text_body = "\n".join(text_lines)

    memo_html = f"<p><strong>Memo:</strong> {invoice.memo}</p>" if invoice.memo else ""
    html_body = f"""<html>
  <body>
    <p>{greeting}</p>
    <p>A quick reminder that invoice <strong>{invoice.invoice_number}</strong> is overdue.</p>
    <p><strong>Balance due:</strong> {formatted_balance} (originally due {due_date}).</p>
    {memo_html}
    <h3>Next steps</h3>
    <ul>
      <li>Review the invoice in the SMPLAT billing center.</li>
      <li>Pay online or reach out if you need a revised schedule.</li>
    </ul>
    <p>We're here to help if you have questions.</p>
    <p>The SMPLAT Finance Team</p>
  </body>
</html>"""

    return RenderedTemplate(subject=subject, text_body=text_body, html_body=html_body)


def render_loyalty_tier_upgrade(
    member: LoyaltyMember,
    tier: LoyaltyTier,
    *,
    contact_name: str | None,
) -> RenderedTemplate:
    """Render notification when a loyalty member upgrades tiers."""

    greeting = f"Hi {contact_name}," if contact_name else "Hi there,"
    subject = f"You've reached {tier.name} status on SMPLAT"

    benefits_lines = []
    if isinstance(tier.benefits, (list, tuple)) and tier.benefits:
        benefits_lines.extend(["", "New benefits:"])
        benefits_lines.extend(f"- {html.escape(str(benefit))}" for benefit in tier.benefits)

    text_lines = [
        greeting,
        "",
        f"Congratulations! You've unlocked the {tier.name} tier.",
        "Your engagement has earned additional perks immediately available in your dashboard.",
    ]
    text_lines.extend(benefits_lines)
    text_lines.extend([
        "",
        "Keep building momentum to access the next milestone.",
        "The SMPLAT Team",
    ])

    text_body = "\n".join(text_lines)

    benefits_html = ""
    if isinstance(tier.benefits, (list, tuple)) and tier.benefits:
        benefit_items = "".join(
            f"<li>{html.escape(str(benefit))}</li>" for benefit in tier.benefits
        )
        benefits_html = f"""
    <h3>New benefits</h3>
    <ul>{benefit_items}</ul>
"""

    html_body = f"""<html>
  <body>
    <p>{greeting}</p>
    <p>Congratulations! You've unlocked the <strong>{html.escape(tier.name)}</strong> tier.</p>
    <p>Your engagement has earned additional perks immediately available in your dashboard.</p>
    {benefits_html}
    <p>Keep building momentum to access the next milestone.</p>
    <p>The SMPLAT Team</p>
  </body>
</html>"""

    return RenderedTemplate(subject=subject, text_body=text_body, html_body=html_body)
