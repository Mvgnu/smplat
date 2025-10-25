"""Email backend implementations for notifications."""

from __future__ import annotations

import asyncio
import smtplib
from dataclasses import dataclass
from email.message import EmailMessage
from typing import List, Optional, Protocol


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
    ) -> None:
        ...


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
    ) -> None:
        message = EmailMessage()
        message["To"] = recipient
        message["Subject"] = subject
        if reply_to:
            message["Reply-To"] = reply_to
        message.set_content(body_text)
        if body_html:
            message.add_alternative(body_html, subtype="html")
        self.sent_messages.append(message)
