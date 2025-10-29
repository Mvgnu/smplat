"""High-level notification service for transactional emails."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Iterable, Optional, Sequence
from uuid import UUID

from loguru import logger
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from smplat_api.core.settings import get_settings
from smplat_api.models.fulfillment import FulfillmentTask, FulfillmentTaskStatusEnum
from smplat_api.models.loyalty import (
    LoyaltyMember,
    LoyaltyNudge,
    LoyaltyNudgeStatus,
    LoyaltyTier,
)
from smplat_api.models.order import Order, OrderItem, OrderStatusEnum
from smplat_api.models.payment import Payment
from smplat_api.models.user import User
from smplat_api.models.notification import NotificationPreference
from smplat_api.models.invoice import Invoice, InvoiceStatusEnum

from .backend import EmailBackend, SMTPEmailBackend, InMemoryEmailBackend
from .templates import (
    RenderedTemplate,
    render_invoice_overdue,
    render_fulfillment_completion,
    render_fulfillment_retry,
    render_loyalty_tier_upgrade,
    render_onboarding_concierge_nudge,
    render_payment_success,
    render_weekly_digest,
)


@dataclass
class NotificationEvent:
    """Representation of a notification that was sent."""

    recipient: str
    subject: str
    body_text: str
    body_html: str | None
    event_type: str
    metadata: dict[str, Any]


@dataclass
class _OrderContact:
    email: str
    display_name: Optional[str]


@dataclass
class _PreferenceSnapshot:
    order_updates: bool = True
    payment_updates: bool = True
    fulfillment_alerts: bool = True
    marketing_messages: bool = False
    billing_alerts: bool = False


class NotificationService:
    """Coordinates notification delivery via pluggable backends."""

    def __init__(
        self,
        db_session: AsyncSession,
        backend: Optional[EmailBackend] = None,
    ) -> None:
        self._db = db_session
        self._backend = backend or self._build_default_backend()
        self._events: list[NotificationEvent] = []

    @property
    def sent_events(self) -> list[NotificationEvent]:
        """Expose events (useful for tests when using in-memory backend)."""
        return self._events

    async def send_order_status_update(
        self,
        order: Order,
        *,
        previous_status: OrderStatusEnum | None = None,
        trigger: str | None = None,
    ) -> None:
        """Send a notification when an order status changes."""
        if self._backend is None:
            return

        contact = await self._resolve_order_contact(order)
        if contact is None:
            return

        preferences = await self._get_preferences(order.user_id)
        if not preferences.order_updates:
            return

        prev_label = (
            previous_status.value.replace("_", " ").title() if previous_status else "Created"
        )
        new_label = order.status.value.replace("_", " ").title()

        subject = f"Order {order.order_number} is now {new_label}"
        body_lines = [
            f"Hi {contact.display_name or 'there'},",
            "",
            f"Your order {order.order_number} has moved from {prev_label} to {new_label}.",
            f"Total value: €{float(order.total):.2f}",
        ]
        if trigger:
            body_lines.append(f"Trigger: {trigger}")
        if order.notes:
            body_lines.extend(["", "Latest notes:", order.notes])
        body_lines.extend(
            [
                "",
                "You can review your order progress by logging into the SMPLAT dashboard.",
                "",
                "Thanks,",
                "The SMPLAT Team",
            ]
        )
        text_body = "\n".join(body_lines)

        notes_html = ""
        if order.notes:
            notes_html = f"""
    <p><strong>Latest notes:</strong></p>
    <p>{order.notes}</p>"""
        trigger_html = f"<p><strong>Trigger:</strong> {trigger}</p>" if trigger else ""
        html_body = f"""<html>
  <body>
    <p>Hi {contact.display_name or 'there'},</p>
    <p>Your order <strong>{order.order_number}</strong> has moved from <strong>{prev_label}</strong> to <strong>{new_label}</strong>.</p>
    <p>Total value: €{float(order.total):.2f}</p>
    {trigger_html}{notes_html}
    <p>You can review your order progress by logging into the SMPLAT dashboard.</p>
    <p>Thanks,<br />The SMPLAT Team</p>
  </body>
</html>"""

        await self._deliver(
            contact,
            RenderedTemplate(subject=subject, text_body=text_body, html_body=html_body),
            event_type="order_status_update",
            metadata={
                "order_id": str(order.id),
                "order_number": order.order_number,
                "previous_status": previous_status.value if previous_status else None,
                "current_status": order.status.value,
                "trigger": trigger,
            },
        )

    async def send_payment_success(self, payment: Payment) -> None:
        """Send a receipt when payment is marked as succeeded."""
        if self._backend is None:
            return

        order = payment.order
        if order is None:
            stmt = select(Order).where(Order.id == payment.order_id)
            result = await self._db.execute(stmt)
            order = result.scalar_one_or_none()
            if order is None:
                return

        contact = await self._resolve_order_contact(order)
        if contact is None:
            return

        preferences = await self._get_preferences(order.user_id)
        if not preferences.payment_updates:
            return

        template = render_payment_success(order, payment, contact.display_name)
        metadata = {
            "order_id": str(order.id),
            "order_number": order.order_number,
            "payment_id": str(payment.id),
            "amount": str(payment.amount),
            "currency": payment.currency.value if hasattr(payment.currency, "value") else str(payment.currency),
        }
        await self._deliver(contact, template, event_type="payment_success", metadata=metadata)

    async def send_fulfillment_retry(self, order: Order, task: FulfillmentTask) -> None:
        """Notify customer when a fulfillment task is scheduled for retry."""
        if self._backend is None:
            return

        contact = await self._resolve_order_contact(order)
        if contact is None:
            return

        preferences = await self._get_preferences(order.user_id)
        if not preferences.fulfillment_alerts:
            return

        template = render_fulfillment_retry(
            order,
            task,
            contact_name=contact.display_name,
            retry_count=task.retry_count or 0,
            max_retries=task.max_retries or 0,
            next_run_at=task.scheduled_at,
        )
        metadata = {
            "order_id": str(order.id),
            "order_number": order.order_number,
            "task_id": str(task.id),
            "task_type": task.task_type.value,
            "retry_count": task.retry_count,
            "max_retries": task.max_retries,
            "scheduled_at": task.scheduled_at.isoformat() if task.scheduled_at else None,
        }
        await self._deliver(contact, template, event_type="fulfillment_retry", metadata=metadata)

    async def send_fulfillment_completion(self, order: Order) -> None:
        """Notify customer when fulfillment completes."""
        if self._backend is None:
            return

        contact = await self._resolve_order_contact(order)
        if contact is None:
            return

        preferences = await self._get_preferences(order.user_id)
        if not preferences.fulfillment_alerts:
            return

        order_with_tasks = order
        if not getattr(order_with_tasks, "items", None):
            stmt = (
                select(Order)
                .options(selectinload(Order.items).selectinload(OrderItem.fulfillment_tasks))
                .where(Order.id == order.id)
            )
            result = await self._db.execute(stmt)
            fetched = result.scalar_one_or_none()
            if fetched:
                order_with_tasks = fetched

        completed_tasks: list[FulfillmentTask] = []
        for item in getattr(order_with_tasks, "items", []):
            for task in getattr(item, "fulfillment_tasks", []):
                if task.status == FulfillmentTaskStatusEnum.COMPLETED:
                    completed_tasks.append(task)

        template = render_fulfillment_completion(
            order_with_tasks,
            contact_name=contact.display_name,
            completed_tasks=completed_tasks,
        )
        metadata = {
            "order_id": str(order.id),
            "order_number": order.order_number,
            "tasks_completed": len(completed_tasks),
        }
        await self._deliver(contact, template, event_type="fulfillment_completion", metadata=metadata)

    async def send_invoice_overdue(self, invoice: Invoice) -> None:
        """Send an overdue reminder when billing alerts are enabled."""
        if self._backend is None:
            return

        contact = await self._resolve_workspace_contact(invoice.workspace_id)
        if contact is None:
            return

        preferences = await self._get_preferences(invoice.workspace_id)
        if not preferences.billing_alerts:
            return

        status_value = invoice.status.value if isinstance(invoice.status, InvoiceStatusEnum) else str(invoice.status)
        if status_value == InvoiceStatusEnum.PAID.value:
            return

        template = render_invoice_overdue(invoice, contact.display_name)
        metadata = {
            "invoice_id": str(invoice.id),
            "invoice_number": invoice.invoice_number,
            "workspace_id": str(invoice.workspace_id),
            "status": status_value,
            "balance_due": str(invoice.balance_due),
        }
        await self._deliver(contact, template, event_type="invoice_overdue", metadata=metadata)

    async def send_weekly_digest(
        self,
        user: User,
        *,
        highlighted_orders: Iterable[Order],
        pending_actions: Sequence[str],
    ) -> None:
        """Send weekly digest with key actions."""
        if self._backend is None or not user.email:
            return

        preferences = await self._get_preferences(user.id)
        if not preferences.marketing_messages:
            return

        contact = _OrderContact(email=user.email, display_name=user.display_name)
        orders_list = list(highlighted_orders)
        pending_list = list(pending_actions)
        template = render_weekly_digest(
            user,
            highlighted_orders=orders_list,
            pending_actions=pending_list,
        )
        metadata = {
            "user_id": str(user.id) if user.id else None,
            "pending_actions": pending_list,
            "orders": [order.order_number for order in orders_list],
        }
        await self._deliver(contact, template, event_type="weekly_digest", metadata=metadata)

    def use_in_memory_backend(self) -> InMemoryEmailBackend:
        """Replace backend with in-memory implementation (useful for tests)."""
        backend = InMemoryEmailBackend()
        self._backend = backend
        return backend

    async def send_onboarding_concierge_nudge(
        self,
        order: Order,
        *,
        subject: str,
        message_text: str,
        triggered_by: str,
    ) -> bool:
        """Deliver concierge nudges while honoring notification opt-ins."""

        if self._backend is None:
            return False

        contact = await self._resolve_order_contact(order)
        if contact is None:
            return False

        preferences = await self._get_preferences(order.user_id)
        if not preferences.order_updates:
            return False

        template = render_onboarding_concierge_nudge(
            order,
            contact_name=contact.display_name,
            subject=subject,
            message_text=message_text,
        )
        metadata = {
            "order_id": str(order.id),
            "order_number": order.order_number,
            "triggered_by": triggered_by,
            "subject": subject,
        }
        await self._deliver(
            contact,
            template,
            event_type="onboarding_concierge_nudge",
            metadata=metadata,
        )
        return True

    def _build_default_backend(self) -> Optional[EmailBackend]:
        settings = get_settings()
        if not settings.smtp_host or not settings.smtp_sender_email:
            return None

        return SMTPEmailBackend(
            host=settings.smtp_host,
            port=settings.smtp_port,
            username=settings.smtp_username,
            password=settings.smtp_password,
            use_tls=settings.smtp_use_tls,
            sender_email=settings.smtp_sender_email,
        )

    async def _resolve_order_contact(self, order: Order) -> Optional[_OrderContact]:
        """Fetch the user contact for an order."""
        if not order.user_id:
            return None

        stmt = select(User).where(User.id == order.user_id)
        result = await self._db.execute(stmt)
        user = result.scalar_one_or_none()
        if not user or not user.email:
            return None

        return _OrderContact(email=user.email, display_name=user.display_name)

    async def _resolve_user_contact(self, user_id: Optional[UUID]) -> Optional[_OrderContact]:
        """Resolve a direct contact for a user id."""

        if user_id is None:
            return None

        stmt = select(User).where(User.id == user_id)
        result = await self._db.execute(stmt)
        user = result.scalar_one_or_none()
        if not user or not user.email:
            return None

        return _OrderContact(email=user.email, display_name=user.display_name)

    async def _resolve_workspace_contact(self, workspace_id: Optional[UUID]) -> Optional[_OrderContact]:
        """Resolve the primary workspace contact for billing alerts."""
        if workspace_id is None:
            return None

        stmt = select(User).where(User.id == workspace_id)
        result = await self._db.execute(stmt)
        user = result.scalar_one_or_none()
        if not user or not user.email:
            return None

        return _OrderContact(email=user.email, display_name=user.display_name)

    async def _get_preferences(self, user_id: Optional[UUID]) -> _PreferenceSnapshot:
        """Return notification preferences for the provided user."""
        if user_id is None:
            return _PreferenceSnapshot()

        stmt = select(NotificationPreference).where(NotificationPreference.user_id == user_id)
        result = await self._db.execute(stmt)
        preference = result.scalar_one_or_none()

        if preference is None:
            return _PreferenceSnapshot()

        return _PreferenceSnapshot(
            order_updates=preference.order_updates,
            payment_updates=preference.payment_updates,
            fulfillment_alerts=preference.fulfillment_alerts,
            marketing_messages=preference.marketing_messages,
            billing_alerts=preference.billing_alerts,
        )

    async def send_loyalty_tier_upgrade(
        self,
        member: LoyaltyMember,
        tier: LoyaltyTier,
    ) -> None:
        """Send milestone notification when a member reaches a tier."""

        if self._backend is None:
            return

        contact = await self._resolve_user_contact(member.user_id)
        if contact is None:
            return

        preferences = await self._get_preferences(member.user_id)
        if not preferences.marketing_messages:
            logger.info(
                "Skipping loyalty tier notification due to preferences",
                user_id=str(member.user_id),
            )
            return

        template = render_loyalty_tier_upgrade(
            member,
            tier,
            contact_name=contact.display_name,
        )
        metadata = {
            "member_id": str(member.id),
            "tier_id": str(tier.id),
            "tier_slug": tier.slug,
        }
        await self._deliver(
            contact,
            template,
            event_type="loyalty_tier_upgrade",
            metadata=metadata,
        )

    async def send_loyalty_nudge(
        self,
        member: LoyaltyMember,
        nudge: LoyaltyNudge,
    ) -> None:
        """Send a proactive loyalty nudge notification honoring preferences."""

        if self._backend is None:
            return

        if nudge.status != LoyaltyNudgeStatus.ACTIVE:
            return

        contact = await self._resolve_user_contact(member.user_id)
        if contact is None:
            return

        preferences = await self._get_preferences(member.user_id)
        if not preferences.marketing_messages:
            logger.info(
                "Skipping loyalty nudge due to marketing preferences",
                user_id=str(member.user_id),
                nudge_id=str(nudge.id),
            )
            return

        payload = dict(nudge.payload_json or {})
        headline = str(payload.get("headline") or "Loyalty reminder")
        body = str(payload.get("body") or "There is new activity waiting for you.")
        cta_label = payload.get("ctaLabel")
        cta_href = payload.get("ctaHref")
        metadata = {"nudge_id": str(nudge.id), "nudge_type": nudge.nudge_type.value}
        metadata.update(payload.get("metadata") or {})

        body_lines = [f"Hi {contact.display_name or 'there'},", "", body]
        html_cta = ""
        if cta_label and cta_href:
            body_lines.extend(["", f"{cta_label}: {cta_href}"])
            html_cta = f"<p><a href=\"{cta_href}\">{cta_label}</a></p>"

        body_lines.extend(["", "Thanks,", "The SMPLAT Team"])
        text_body = "\n".join(body_lines)
        html_body = f"""<html>
  <body>
    <p>Hi {contact.display_name or 'there'},</p>
    <p>{body}</p>
    {html_cta}
    <p>Thanks,<br />The SMPLAT Team</p>
  </body>
</html>"""

        template = RenderedTemplate(
            subject=headline,
            text_body=text_body,
            html_body=html_body,
        )

        await self._deliver(
            contact,
            template,
            event_type="loyalty_nudge",
            metadata=metadata,
        )

    async def _deliver(
        self,
        contact: _OrderContact,
        template: RenderedTemplate,
        *,
        event_type: str,
        metadata: dict[str, Any],
        reply_to: str | None = None,
    ) -> None:
        """Send using active backend and record emitted event."""
        if self._backend is None:
            return

        await self._backend.send_email(
            contact.email,
            template.subject,
            template.text_body,
            body_html=template.html_body,
            reply_to=reply_to,
        )
        self._events.append(
            NotificationEvent(
                recipient=contact.email,
                subject=template.subject,
                body_text=template.text_body,
                body_html=template.html_body,
                event_type=event_type,
                metadata=metadata,
            )
        )
