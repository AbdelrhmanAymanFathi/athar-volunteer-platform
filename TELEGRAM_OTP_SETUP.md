# Telegram OTP Setup

This project now includes a free Telegram-based OTP flow for registration.

Important:
- This is not SMS to the phone number.
- The user must open your Telegram bot and receive the code inside Telegram.
- The frontend expects the OTP server at `http://localhost:8787` by default.

## 1. Create a Telegram bot

1. Open `@BotFather` in Telegram.
2. Run `/newbot`.
3. Copy the bot token.
4. Note the bot username.

## 2. Configure environment variables

In PowerShell:

```powershell
$env:TELEGRAM_BOT_TOKEN="123456789:replace_with_your_bot_token"
$env:TELEGRAM_BOT_USERNAME="your_bot_username"
$env:PORT="8787"
```

You can also copy values from `.env.example` manually.

## 3. Start the OTP server

```powershell
npm run telegram-otp
```

Or directly:

```powershell
node .\telegram-otp-server.mjs
```

## 4. Run the frontend

Serve the site the same way you already use for this project.

## 5. Registration flow

1. User fills the registration form.
2. Frontend requests a Telegram OTP session.
3. User opens the bot link.
4. User sends `/start` through the deep link.
5. Bot sends a 6-digit code inside Telegram.
6. User enters the code in the registration panel.
7. Account creation completes.

## Notes

- Telegram Bot API is free, but this still depends on Telegram as an external service.
- This verifies Telegram ownership, not phone-number ownership.
- For real phone-number verification, you still need SMS or WhatsApp infrastructure.