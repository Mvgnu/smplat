"""Notification templates for transactional events."""

from __future__ import annotations

import html
from dataclasses import dataclass
from datetime import datetime
from decimal import Decimal, InvalidOperation
from typing import Any, Iterable, Sequence

from smplat_api.models.fulfillment import FulfillmentTask
from smplat_api.models.invoice import Invoice
from smplat_api.models.loyalty import LoyaltyMember, LoyaltyTier
from smplat_api.models.order import Order, OrderItem
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


def _clean_str(value: Any) -> str | None:
    if isinstance(value, str):
        stripped = value.strip()
        return stripped or None
    return None


def _coerce_decimal(value: Any) -> Decimal | None:
    if isinstance(value, Decimal):
        return value
    if isinstance(value, (int, float)):
        return Decimal(str(value))
    if isinstance(value, str):
        stripped = value.strip()
        if not stripped:
            return None
        try:
            return Decimal(stripped)
        except (InvalidOperation, ValueError):
            return None
    return None


def _build_blueprint_text(items: Iterable[OrderItem], currency: str) -> list[str]:
    lines: list[str] = []
    for item in items:
        snapshot = item.selected_options
        if not isinstance(snapshot, dict):
            continue

        item_lines: list[str] = []

        options = snapshot.get("options")
        option_lines: list[str] = []
        if isinstance(options, list):
            for option in options:
                if not isinstance(option, dict):
                    continue
                label = _clean_str(option.get("label"))
                if not label:
                    continue
                group = _clean_str(option.get("groupName")) or _clean_str(option.get("groupId")) or "Option"
                option_lines.append(f"  • {group}: {label}")

                tagline = _clean_str(option.get("marketingTagline"))
                if tagline:
                    option_lines.append(f"    Tagline: {tagline}")

                sla = _clean_str(option.get("fulfillmentSla"))
                if sla:
                    option_lines.append(f"    SLA: {sla}")

                hero = _clean_str(option.get("heroImageUrl"))
                if hero:
                    option_lines.append(f"    Hero asset: {hero}")

                calculator = option.get("calculator")
                if isinstance(calculator, dict):
                    expression = _clean_str(calculator.get("expression"))
                    if expression:
                        option_lines.append(f"    Calculator: {expression}")
                    samples: list[str] = []
                    for label_key, field in (("input", "sampleAmount"), ("days", "sampleDays"), ("result", "sampleResult")):
                        sample_value = calculator.get(field)
                        if sample_value is not None:
                            samples.append(f"{label_key} {sample_value}")
                    if samples:
                        option_lines.append(f"    Samples: {', '.join(samples)}")

        if option_lines:
            item_lines.append("  Options:")
            item_lines.extend(option_lines)

        add_ons = snapshot.get("addOns")
        add_on_lines: list[str] = []
        if isinstance(add_ons, list):
            for add_on in add_ons:
                if not isinstance(add_on, dict):
                    continue
                label = _clean_str(add_on.get("label")) or "Add-on"
                qualifier_parts: list[str] = []
                provider = _clean_str(add_on.get("serviceProviderName"))
                if provider:
                    qualifier_parts.append(provider)
                service_id = _clean_str(add_on.get("serviceId"))
                if service_id:
                    qualifier_parts.append(f"service {service_id}")
                descriptor = f" ({', '.join(qualifier_parts)})" if qualifier_parts else ""
                add_on_lines.append(f"  • {label}{descriptor}")
                delta = _coerce_decimal(add_on.get("priceDelta"))
                if delta is not None:
                    sign = "+" if delta >= 0 else "-"
                    add_on_lines.append(f"    Delta: {sign}{_format_currency(abs(delta), currency)}")

        if add_on_lines:
            item_lines.append("  Add-ons:")
            item_lines.extend(add_on_lines)

        plan = snapshot.get("subscriptionPlan")
        plan_lines: list[str] = []
        if isinstance(plan, dict):
            plan_label = _clean_str(plan.get("label"))
            if plan_label:
                plan_lines.append(f"  • {plan_label}")
            billing = _clean_str(plan.get("billingCycle"))
            if billing:
                plan_lines.append(f"    Billing: {billing.replace('_', ' ')}")
            multiplier = plan.get("priceMultiplier")
            multiplier_value: float | None = None
            if isinstance(multiplier, (int, float)):
                multiplier_value = float(multiplier)
            elif isinstance(multiplier, str) and multiplier.strip():
                try:
                    multiplier_value = float(multiplier)
                except ValueError:
                    multiplier_value = None
            if multiplier_value is not None:
                plan_lines.append(f"    Multiplier: {multiplier_value:.2f}")
            delta = _coerce_decimal(plan.get("priceDelta"))
            if delta is not None:
                sign = "+" if delta >= 0 else "-"
                plan_lines.append(f"    Delta: {sign}{_format_currency(abs(delta), currency)}")

        if plan_lines:
            item_lines.append("  Subscription plan:")
            item_lines.extend(plan_lines)

        if item_lines:
            product_title = _clean_str(getattr(item, "product_title", "")) or "Order item"
            lines.append(f"- {product_title}:")
            lines.extend(item_lines)

    return lines


def _build_calculator_html(calculator: Any) -> str:
    if not isinstance(calculator, dict):
        return ""
    expression = _clean_str(calculator.get("expression"))
    if not expression:
        return ""
    samples: list[str] = []
    for label, field in (("Input", "sampleAmount"), ("Days", "sampleDays"), ("Result", "sampleResult")):
        value = calculator.get(field)
        if value is not None:
            samples.append(f"{label}: {value}")
    sample_html = ""
    if samples:
        sample_html = f"<div style=\"font-size:12px;color:#555;margin-top:4px;\">{' • '.join(html.escape(sample) for sample in samples)}</div>"
    return f"""
        <div style="margin-top:6px;padding:8px;border:1px solid #ececec;border-radius:8px;background:#f8f8f8;">
          <div style="font-size:11px;text-transform:uppercase;letter-spacing:0.08em;color:#7a7a7a;">Calculator</div>
          <code style="font-family:monospace;color:#1d1d1f;">{html.escape(expression)}</code>
          {sample_html}
        </div>
    """


def _build_option_html(snapshot: dict[str, Any]) -> str:
    options = snapshot.get("options")
    if not isinstance(options, list):
        return ""

    items: list[str] = []
    for option in options:
        if not isinstance(option, dict):
            continue
        label = _clean_str(option.get("label"))
        if not label:
            continue
        group = _clean_str(option.get("groupName")) or _clean_str(option.get("groupId")) or "Option"
        segments: list[str] = []
        tagline = _clean_str(option.get("marketingTagline"))
        if tagline:
            segments.append(f"<div style=\"font-size:13px;color:#444;\">{html.escape(tagline)}</div>")
        sla = _clean_str(option.get("fulfillmentSla"))
        if sla:
            segments.append(f"<div style=\"font-size:12px;color:#666;\">SLA: {html.escape(sla)}</div>")
        hero = _clean_str(option.get("heroImageUrl"))
        if hero:
            segments.append(f"<div style=\"font-size:12px;color:#666;\">Hero asset: {html.escape(hero)}</div>")
        calculator_html = _build_calculator_html(option.get("calculator"))
        if calculator_html:
            segments.append(calculator_html)
        detail_html = "".join(segments)
        items.append(
            f"""
        <li style="margin-bottom:10px;">
          <div style="font-weight:600;color:#111;">{html.escape(group)}: {html.escape(label)}</div>
          {detail_html}
        </li>
        """
        )

    if not items:
        return ""

    return f"""
      <p style="margin:8px 0 4px 0;font-size:13px;color:#555;">Blueprint options</p>
      <ul style="margin:0;padding-left:18px;color:#222;font-size:13px;">
        {''.join(items)}
      </ul>
    """


def _build_add_on_html(snapshot: dict[str, Any], currency: str) -> str:
    add_ons = snapshot.get("addOns")
    if not isinstance(add_ons, list):
        return ""

    items: list[str] = []
    for add_on in add_ons:
        if not isinstance(add_on, dict):
            continue
        label = _clean_str(add_on.get("label"))
        if not label:
            continue
        provider = _clean_str(add_on.get("serviceProviderName"))
        service_id = _clean_str(add_on.get("serviceId"))
        subtitle_parts: list[str] = []
        if provider:
            subtitle_parts.append(provider)
        if service_id:
            subtitle_parts.append(f"service {service_id}")
        subtitle = " • ".join(html.escape(part) for part in subtitle_parts) if subtitle_parts else ""
        delta = _coerce_decimal(add_on.get("priceDelta"))
        delta_label = None
        if delta is not None:
            sign = "+" if delta >= 0 else "-"
            delta_label = f"{sign}{_format_currency(abs(delta), currency)}"
        items.append(
            f"""
        <li style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;">
          <div>
            <div style="font-weight:600;color:#111;">{html.escape(label)}</div>
            {f'<div style="font-size:12px;color:#666;">{subtitle}</div>' if subtitle else ''}
          </div>
          {f'<span style="font-size:12px;color:#333;">{delta_label}</span>' if delta_label else ''}
        </li>
        """
        )

    if not items:
        return ""

    return f"""
      <p style="margin:8px 0 4px 0;font-size:13px;color:#555;">Applied add-ons</p>
      <ul style="margin:0;padding-left:0;list-style:none;">{''.join(items)}</ul>
    """


def _build_subscription_html(snapshot: dict[str, Any], currency: str) -> str:
    plan = snapshot.get("subscriptionPlan")
    if not isinstance(plan, dict):
        return ""

    label = _clean_str(plan.get("label"))
    billing = _clean_str(plan.get("billingCycle"))
    multiplier = plan.get("priceMultiplier")
    multiplier_value: float | None = None
    if isinstance(multiplier, (int, float)):
        multiplier_value = float(multiplier)
    elif isinstance(multiplier, str) and multiplier.strip():
        try:
            multiplier_value = float(multiplier)
        except ValueError:
            multiplier_value = None
    delta = _coerce_decimal(plan.get("priceDelta"))
    details: list[str] = []
    if billing:
        details.append(f"Billing: {billing.replace('_', ' ')}")
    if multiplier_value is not None:
        details.append(f"Multiplier {multiplier_value:.2f}")
    if delta is not None:
        sign = "+" if delta >= 0 else "-"
        details.append(f"Delta {sign}{_format_currency(abs(delta), currency)}")

    if not (label or details):
        return ""

    detail_html = "<br />".join(html.escape(detail) for detail in details) if details else ""
    label_html = html.escape(label) if label else "Subscription"
    return f"""
      <p style="margin:8px 0 4px 0;font-size:13px;color:#555;">Subscription plan</p>
      <div style="font-size:13px;color:#222;">
        <strong>{label_html}</strong><br />
        {detail_html}
      </div>
    """


def _build_blueprint_html(items: Iterable[OrderItem], currency: str, *, title: str = "Blueprint snapshot") -> str:
    sections: list[str] = []
    for item in items:
        snapshot = item.selected_options
        if not isinstance(snapshot, dict):
            continue
        option_html = _build_option_html(snapshot)
        add_on_html = _build_add_on_html(snapshot, currency)
        subscription_html = _build_subscription_html(snapshot, currency)
        combined = "".join(part for part in (option_html, add_on_html, subscription_html) if part.strip())
        if not combined:
            continue
        product_title = _clean_str(getattr(item, "product_title", "")) or "Order item"
        sections.append(
            f"""
      <div style="margin-bottom:16px;padding:12px;border:1px solid #eaeaea;border-radius:12px;background:#fafafa;">
        <p style="margin:0 0 6px 0;font-weight:600;color:#111;">{html.escape(product_title)}</p>
        {combined}
      </div>
      """
        )

    if not sections:
        return ""

    escaped_title = html.escape(title)
    return (
        f"""
    <div style="margin-top:24px;">
      <h3 style="font-size:16px;margin-bottom:8px;">{escaped_title}</h3>
"""
        + "".join(sections)
        + "    </div>"
    )


def render_payment_success(order: Order, payment: Payment, contact_name: str | None) -> RenderedTemplate:
    amount = payment.amount if isinstance(payment.amount, Decimal) else Decimal(payment.amount)
    currency = payment.currency.value if hasattr(payment.currency, "value") else str(payment.currency)
    formatted_amount = _format_currency(amount, currency)
    subject = f"Payment received for order {order.order_number}"
    greeting = f"Hi {contact_name}," if contact_name else "Hi there,"

    order_currency = order.currency.value if hasattr(order.currency, "value") else str(order.currency)

    text_lines = [
        greeting,
        "",
        f"We received your payment of {formatted_amount} for order {order.order_number}.",
        "Our fulfillment team is preparing the next steps.",
        "",
        "What to expect next:",
        "- We will start fulfillment tasks within the next business day.",
        "- You can track progress in the SMPLAT dashboard.",
    ]
    blueprint_text = _build_blueprint_text(order.items, order_currency)
    if blueprint_text:
        text_lines.extend(["", "Blueprint snapshot:"])
        text_lines.extend(blueprint_text)
    text_lines.extend(
        [
            "",
            "Thanks for partnering with SMPLAT.",
            "The SMPLAT Team",
        ]
    )
    text_body = "\n".join(text_lines)

    blueprint_html = _build_blueprint_html(order.items, order_currency)

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
    {blueprint_html}
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
    order_currency = order.currency.value if hasattr(order.currency, "value") else str(order.currency)

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
        ]
    )
    blueprint_text = _build_blueprint_text(order.items, order_currency)
    if blueprint_text:
        text_lines.extend(["", "Blueprint snapshot:"])
        text_lines.extend(blueprint_text)
    text_lines.extend(
        [
            "",
            "Thanks,",
            "The SMPLAT Team",
        ]
    )
    text_body = "\n".join(text_lines)

    blueprint_html = _build_blueprint_html(order.items, order_currency)
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
    {blueprint_html if blueprint_html else ""}
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
    order_currency = order.currency.value if hasattr(order.currency, "value") else str(order.currency)
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
        ]
    )
    blueprint_text = _build_blueprint_text(order.items, order_currency)
    if blueprint_text:
        text_lines.extend(["", "Blueprint snapshot:"])
        text_lines.extend(blueprint_text)
    text_lines.extend(
        [
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
    blueprint_html = _build_blueprint_html(order.items, order_currency)
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
    {blueprint_html}
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
    highlighted_orders_list = list(highlighted_orders)
    for order in highlighted_orders_list:
        status = order.status.value.replace("_", " ") if order.status else "unknown"
        text_lines.append(f"- {order.order_number}: {status}")
    if not highlighted_orders_list:
        text_lines.append("- No active orders this week.")

    if pending_actions:
        text_lines.extend(["", "Pending actions:"])
        text_lines.extend(f"- {item}" for item in pending_actions)
    else:
        text_lines.extend(["", "No pending actions—keep building momentum."])

    blueprint_text_sections: list[str] = []
    blueprint_html_sections: list[str] = []
    for order in highlighted_orders_list:
        currency = order.currency.value if hasattr(order.currency, "value") else str(order.currency)
        order_blueprint = _build_blueprint_text(order.items, currency)
        if order_blueprint:
            reference = order.order_number or str(order.id)
            blueprint_text_sections.append(f"Order {reference} blueprint:")
            blueprint_text_sections.extend(order_blueprint)
            order_html = _build_blueprint_html(
                order.items,
                currency,
                title=f"Order {reference} blueprint",
            )
            if order_html:
                blueprint_html_sections.append(order_html)

    if blueprint_text_sections:
        text_lines.extend(["", "Blueprint snapshots:"])
        text_lines.extend(blueprint_text_sections)

    text_lines.extend(["", "Visit the dashboard for deeper analytics.", "See you next week,", "The SMPLAT Team"])
    text_body = "\n".join(text_lines)

    order_items = "".join(
        f"<li><strong>{order.order_number}</strong>: {order.status.value.replace('_', ' ') if order.status else 'unknown'}</li>"
        for order in highlighted_orders_list
    ) or "<li>No active orders this week.</li>"
    pending_items = "".join(f"<li>{item}</li>" for item in pending_actions)
    pending_section = (
        f"""
    <h3>Pending actions</h3>
    <ul>
      {pending_items}
    </ul>"""
        if pending_actions
        else "<p>No pending actions—keep the momentum going.</p>"
    )
    html_body = f"""<html>
  <body>
    <p>{greeting}</p>
    <p>Here's your weekly summary from SMPLAT.</p>
    <h3>Orders in focus</h3>
    <ul>
      {order_items}
    </ul>{pending_section}
    {''.join(blueprint_html_sections)}
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


def render_invoice_overdue(
    invoice: Invoice,
    contact_name: str | None,
    orders: Sequence[Order] | None = None,
) -> RenderedTemplate:
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
    blueprint_text_sections: list[str] = []
    blueprint_html_sections: list[str] = []
    if orders:
        for order in orders:
            order_items = getattr(order, "items", ())
            order_lines = _build_blueprint_text(order_items, currency)
            if order_lines:
                reference = order.order_number or str(getattr(order, "id", "order"))
                blueprint_text_sections.append(f"Order {reference} blueprint:")
                blueprint_text_sections.extend(order_lines)
                order_html = _build_blueprint_html(
                    order_items,
                    currency,
                    title=f"Order {reference} blueprint",
                )
                if order_html:
                    blueprint_html_sections.append(order_html)

    if blueprint_text_sections:
        text_lines.extend(["", "Blueprint snapshots:"])
        text_lines.extend(blueprint_text_sections)

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
    {''.join(blueprint_html_sections)}
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
