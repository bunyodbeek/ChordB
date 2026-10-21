"""Messages from the API through the Bot API: alerts to ADMIN_IDS, payment news to users.

The recipient must have pressed /start in the bot (or allowed messages), or Telegram
refuses the message.
"""

import logging

import httpx

from chordb_common.config import get_settings

log = logging.getLogger("chordb.alerts")


async def send_message(
    client: httpx.AsyncClient, chat_id: int, text: str, *, web_app_path: str | None = None
) -> bool:
    """One message, optionally with a button opening the Mini App at WEBAPP_URL + path."""
    settings = get_settings()
    body: dict = {"chat_id": chat_id, "text": text}
    if web_app_path is not None and settings.webapp_url.startswith("https://"):
        url = settings.webapp_url.rstrip("/") + web_app_path
        body["reply_markup"] = {
            "inline_keyboard": [[{"text": "ChordB", "web_app": {"url": url}}]]
        }
    try:
        r = await client.post(
            f"https://api.telegram.org/bot{settings.bot_token}/sendMessage", json=body
        )
        r.raise_for_status()
    except httpx.HTTPStatusError as e:
        log.warning("message to %s failed: HTTP %s", chat_id, e.response.status_code)
        return False
    except httpx.HTTPError as e:
        # Never log the exception text: it contains the URL, i.e. the bot token.
        log.warning("message to %s failed: %s", chat_id, type(e).__name__)
        return False
    return True


async def send_admin_alert(text: str, *, web_app_path: str | None = None) -> None:
    settings = get_settings()
    if not settings.admin_id_set:
        log.warning("alert not sent, ADMIN_IDS is empty: %s", text)
        return
    async with httpx.AsyncClient(timeout=10) as client:
        for chat_id in settings.admin_id_set:
            if await send_message(client, chat_id, text, web_app_path=web_app_path):
                log.info("alert sent to %s", chat_id)


async def send_user_message(chat_id: int, text: str, *, web_app_path: str | None = None) -> None:
    async with httpx.AsyncClient(timeout=10) as client:
        await send_message(client, chat_id, text, web_app_path=web_app_path)
