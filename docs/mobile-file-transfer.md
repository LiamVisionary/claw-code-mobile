# Getting files onto the dev server from mobile

Sometimes you need to hand a file (an image asset, a log, a patch, etc.) to
the running dev server — but you're working from your phone via SSH
(Termius, Blink, etc.) and your SSH client doesn't support file upload.
Laptop's not an option. Here's how.

The trick is the **Telegram bot** you already set up for dev-tunnel
notifications. Telegram's bot API exposes a file-download endpoint, so
anything you send to the bot from your phone can be pulled down on the
server side by curl / python / node — no SSH upload needed.

## Prerequisites

You must have the Telegram bot integration already configured. The
dev-tunnel script relies on the same environment variables:

```bash
# .env (repo root)
TELEGRAM_BOT_TOKEN=123456:ABC...       # from @BotFather
TELEGRAM_CHAT_ID=987654321             # your user/chat id
```

If the tunnel's "Open in Expo Go" notifications are working, the bot is
configured correctly.

## Sending a file

**Always send as a file / document**, never as a photo. Telegram re-encodes
photos to JPEG and strips alpha. Documents are uploaded byte-for-byte, so
PNG transparency and original resolution are preserved.

In Telegram iOS:

1. Open the chat with your bot.
2. Tap the **📎 paperclip** icon.
3. Tap **File**.
4. Tap **Photo Library** (or **Browse** if the file is elsewhere).
5. Select the file and send.

For text / code snippets, you can paste directly into the chat — the bot
API returns the message body in `message.text`, no file needed.

## Fetching it on the server

Use the Telegram Bot API directly — no package install required.

```bash
python3 - <<'PY'
import os, json, urllib.request, sys

# Load TELEGRAM_BOT_TOKEN from .env
with open('.env') as f:
    for line in f:
        if '=' in line:
            k, v = line.strip().split('=', 1)
            os.environ[k] = v.strip('"')

token = os.environ['TELEGRAM_BOT_TOKEN']
api = f'https://api.telegram.org/bot{token}'

# 1. Pull recent updates — getUpdates only returns pending messages that
#    haven't been "consumed" by a webhook or a previous getUpdates call.
updates = json.loads(urllib.request.urlopen(f'{api}/getUpdates').read())['result']

# 2. Find the most recent DOCUMENT upload (ignore plain text + photos).
docs = [u for u in updates if u.get('message', {}).get('document')]
if not docs:
    sys.exit('no document in recent updates — send the file to the bot first')
doc = docs[-1]['message']['document']
print(f'found: {doc["file_name"]} ({doc["mime_type"]}, {doc["file_size"]} bytes)')

# 3. Resolve the file_id → file_path.
fp = json.loads(urllib.request.urlopen(
    f'{api}/getFile?file_id={doc["file_id"]}'
).read())['result']['file_path']

# 4. Download byte-for-byte to a local path.
dest = 'assets/icons/thinking-sprite.png'   # adjust per file
urllib.request.urlretrieve(f'https://api.telegram.org/file/bot{token}/{fp}', dest)
print(f'saved → {dest}')
PY
```

Notes:

- `getUpdates` returns the last 24 hours of messages (up to 100) provided
  no webhook is set on the bot. If you've configured a webhook, delete it
  once with `curl -s "$API/deleteWebhook"` and the polling API starts
  returning updates again.
- Files up to 20 MB go through `/file/bot<TOKEN>/<path>`. For larger files
  the Bot API refuses with `file is too big` — use a direct upload host
  instead.
- Replace the `dest` variable for each file you pull down.

## Sending files / text from the server back to the phone

For the reverse direction (copy a log, a diff, a screenshot back to your
phone), use `sendDocument` or `sendMessage`:

```bash
# Send a file
curl -s -F chat_id="$TELEGRAM_CHAT_ID" -F document=@path/to/file.png \
  "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/sendDocument"

# Send text (Markdown)
curl -s -X POST "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/sendMessage" \
  --data-urlencode chat_id="$TELEGRAM_CHAT_ID" \
  --data-urlencode text="Deploy done ✅" \
  --data-urlencode parse_mode="Markdown"
```

## Why not `scp` / `rsync`?

Termius on iOS supports SFTP upload, but only from Termius's own file
picker — you can't pull straight from the system Photos library without
first saving through Files.app (extra friction, often strips metadata).
Telegram is faster because the image/file is already in an app with
direct bot-API integration.
