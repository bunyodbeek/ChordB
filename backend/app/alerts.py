"""Short operational alerts to ADMIN_IDS through the Bot API (no admin UI).

Admins must have pressed /start in the bot, or Telegram refuses the message.
"""

import logging

import httpx

from chordb_common.config import get_settings

log = logging.getLogger("chordb.alerts")


async def send_admin_alert(text: str) -> None:
    settings = get_settings()
    if not settings.admin_id_set:
        log.warning("alert not sent, ADMIN_IDS is empty: %s", text)
        return
    url = f"https://api.telegram.org/bot{settings.bot_token}/sendMessage"
    async with httpx.AsyncClient(timeout=10) as client:
        for chat_id in settings.admin_id_set:
            try:
                r = await client.post(url, json={"chat_id": chat_id, "text": text})
                r.raise_for_status()
            except httpx.HTTPStatusError as e:
                log.warning("alert to %s failed: HTTP %s", chat_id, e.response.status_code)
            except httpx.HTTPError as e:
                # Never log the exception text: it contains the URL, i.e. the bot token.
                log.warning("alert to %s failed: %s", chat_id, type(e).__name__)
            else:
                log.info("alert sent to %s", chat_id)
