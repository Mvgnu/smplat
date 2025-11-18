"""Email backend implementations for notifications."""

from __future__ import annotations

import asyncio
import smtplib
from dataclasses import dataclass
from email.message import EmailMessage
from typing import List, Optional, Protocol, Sequence


class EmailBackend(Protocol):
    """Minimal protocol for sending notification emails."""

    async def send_email(
        self,
        recipient: str,
        subject: str,
        body_text: str,
        *,
        body_html: str | None = None,
        reply_to: str | None = None,
        attachments: Sequence["EmailAttachment"] | None = None,
    ) -> None:
        ...


class SMSBackend(Protocol):
    """Protocol for SMS dispatchers."""

    async def send_sms(self, recipient: str, body_text: str) -> None:
        ...


class PushBackend(Protocol):
    """Protocol for push notification connectors."""

    async def send_push(
        self,
        recipient: str,
        title: str,
        body: str,
        *,
        metadata: Optional[dict[str, str]] = None,
    ) -> None:
        ...


@dataclass(slots=True)
class EmailAttachment:
    """Binary attachment payload for transactional emails."""

    filename: str
    content_type: str
    payload: bytes


class SMTPEmailBackend:
    """SMTP-powered backend that sends emails via standard library."""

    def __init__(
        self,
        *,
        host: str,
        port: int,
        username: Optional[str],
        password: Optional[str],
        use_tls: bool,
        sender_email: str,
    ) -> None:
        self._host = host
        self._port = port
        self._username = username
        self._password = password
        self._use_tls = use_tls
        self._sender_email = sender_email

    async def send_email(
        self,
        recipient: str,
        subject: str,
        body_text: str,
        *,
        body_html: str | None = None,
        reply_to: str | None = None,
        attachments: Sequence[EmailAttachment] | None = None,
    ) -> None:
        """Send email asynchronously by offloading blocking call."""

        message = EmailMessage()
        message["From"] = self._sender_email
        message["To"] = recipient
        message["Subject"] = subject
        if reply_to:
            message["Reply-To"] = reply_to
        message.set_content(body_text)
        if body_html:
            message.add_alternative(body_html, subtype="html")
        _attach_files(message, attachments)

        await asyncio.to_thread(self._send, message)

    def _send(self, message: EmailMessage) -> None:
        if self._use_tls:
            smtp: smtplib.SMTP = smtplib.SMTP(self._host, self._port, timeout=10)
            smtp.starttls()
        else:
            smtp = smtplib.SMTP(self._host, self._port, timeout=10)

        try:
            if self._username and self._password:
                smtp.login(self._username, self._password)
            smtp.send_message(message)
        finally:
            smtp.quit()


@dataclass
class InMemoryEmailBackend:
    """Test backend storing outbound messages in memory."""

    sent_messages: List[EmailMessage]

    def __init__(self) -> None:
        self.sent_messages = []

    async def send_email(
        self,
        recipient: str,
        subject: str,
        body_text: str,
        *,
        body_html: str | None = None,
        reply_to: str | None = None,
        attachments: Sequence[EmailAttachment] | None = None,
    ) -> None:
        message = EmailMessage()
        message["To"] = recipient
        message["Subject"] = subject
        if reply_to:
            message["Reply-To"] = reply_to
        message.set_content(body_text)
        if body_html:
            message.add_alternative(body_html, subtype="html")
        _attach_files(message, attachments)
        self.sent_messages.append(message)


@dataclass
class InMemorySMSBackend:
    """Stores SMS payloads for inspection in tests."""

    sent_messages: List[tuple[str, str]]

    def __init__(self) -> None:
        self.sent_messages = []

    async def send_sms(self, recipient: str, body_text: str) -> None:
        self.sent_messages.append((recipient, body_text))


@dataclass
class InMemoryPushBackend:
    """In-memory push dispatcher for validation."""

    sent_messages: List[dict[str, str]]

    def __init__(self) -> None:
        self.sent_messages = []

    async def send_push(
        self,
        recipient: str,
        title: str,
        body: str,
        *,
        metadata: Optional[dict[str, str]] = None,
    ) -> None:
        self.sent_messages.append(
            {
                "recipient": recipient,
                "title": title,
                "body": body,
                "metadata": metadata or {},
            }
        )


def _attach_files(message: EmailMessage, attachments: Sequence[EmailAttachment] | None) -> None:
    if not attachments:
        return
    for attachment in attachments:
        content_type = attachment.content_type or "application/octet-stream"
        if "/" in content_type:
            maintype, subtype = content_type.split("/", 1)
        else:
            maintype, subtype = "application", "octet-stream"
        message.add_attachment(
            attachment.payload,
            maintype=maintype,
            subtype=subtype,
            filename=attachment.filename,
        )
