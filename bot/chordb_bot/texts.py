"""All user-facing bot text (Uzbek, Latin script). Bot messages use HTML parse mode."""

from html import escape

OPEN_APP = "🎸 Sozlashni boshlash"
MENU_BUTTON = "Sozlash"


def greeting(first_name: str) -> str:
    return (
        f"Salom, <b>{escape(first_name)}</b>! 👋\n\n"
        "ChordB — gitarangizni tez va aniq sozlash uchun tyuner.\n"
        "Pastdagi tugmani bosing, mikrofonga ruxsat bering va torlarni birma-bir chertib chiqing."
    )


def welcome_followup(first_name: str) -> str:
    return (
        f"{escape(first_name)}, gitarangizni hali sozlamadingizmi? 🎸\n\n"
        "ChordB tyuneri har bir torni bir daqiqada aniq sozlashga yordam beradi."
    )


WEEKLY_REMINDER = (
    "Haftalik mashq vaqti! 🎶\n\n"
    "Mashqdan oldin gitarangizni sozlab oling — bir daqiqa kifoya."
)

NOTIFICATIONS_OFF_BUTTON = "🔕 Eslatmalarni oʻchirish"
NOTIFICATIONS_ON_BUTTON = "🔔 Qayta yoqish"
NOTIFICATIONS_OFF = "Eslatmalar oʻchirildi. Istalgan vaqt qayta yoqishingiz mumkin."
NOTIFICATIONS_ON = "Eslatmalar yoqildi 🔔"

ADMIN_PANEL = (
    "Admin panel. Telegram Desktop’da ochsangiz, keng oynada qulayroq."
)
ADMIN_PANEL_BUTTON = "📊 Admin panel"

PRACTICE_BUTTON = "🎯 Mashqni boshlash"


def practice_reminder(first_name: str, streak: int) -> str:
    keep = f"\n\n🔥 Seriyangiz: {streak} kun — uzib qoʻymang!" if streak > 0 else ""
    return (
        f"{escape(first_name)}, bugungi mashq hali qilinmadi 🎸\n"
        "5 daqiqa: sozlash, akkord almashtirish va quloq testi." + keep
    )
