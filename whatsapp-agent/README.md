# Biome Platform — WhatsApp Agent

Links one WhatsApp account to this PC by QR code, then watches it in the
background. Every document or photo that arrives is downloaded, read,
matched to its coordination reference, and filed.

## What it does with an incoming file

```
  WhatsApp message
        |
        v
  download the media
        |
        v
  AI reads it  -->  what type of document is this?
        |            who issued it?  which client?  which vendor?
        v
  find the coordination reference   BDC / 786 / MHI / 44
        |                            |     |     |    |
        |                            |     |     |    +- vendor's invoice no
        |                            |     |     +------ vendor code
        |                            |     +------------ our invoice/challan no
        |                            +------------------ our company code
        v
  file it
```

## Where files land

Under `Documents/Biome Platform/whatsapp/inbox/`:

```
2026-27/                                     financial year
  Jhajjar Power Limited/                     client (consignee)
    BDC-786-MHI-44/                          coordination reference
      Biome/    Biome Tax Invoice - BI26-27-HR0786.pdf
                Biome Eway Bill - 322301705535.pdf
      Vendor/   Vendor Tax Invoice - 44.pdf
      Shared/   Weight Slip - RJ29GC7686.jpg      (Bill T and the weight
                Bill T - RJ29GC7686.pdf            slip are the same paper
                                                   on both sides)
_Needs Review/2026-07-29/...    arrived, saved, but no reference readable
_Not A Document/2026-07-29/...  a screenshot, a selfie, something unrelated
```

Nothing is ever overwritten. An identical re-send is recognised by its
hash and reuses the existing file instead of making a duplicate; a
different file with the same name becomes `... (2).pdf`.

## Running it

In the installed Windows app it starts and stops automatically with
Biome — there is nothing to do.

In development:

```
npm install
npm run whatsapp:agent      # in its own terminal
npm run dev                 # in another
```

or both at once with `npm run dev:all`.

## Configuration

Optional, at `Documents/Biome Platform/config/whatsapp-settings.json`:

```json
{
  "companyCodes": ["BDC"],
  "allowedChats": [],
  "ignoreOwnMessages": true,
  "autoProcess": true
}
```

- `companyCodes` — the codes that start a reference. Add more if a second
  company code comes into use.
- `allowedChats` — restrict watching to specific chats by WhatsApp JID.
  Leave empty to watch every chat.
- `ignoreOwnMessages` — skip documents you send yourself from the linked
  phone.

## Reading documents

Classification needs a vision-capable AI. Put a key in `.env.local` at the
project root:

```
GEMINI_API_KEY=...        # free, no credit card — aistudio.google.com/apikey
ANTHROPIC_API_KEY=...     # used only if the Gemini key is empty
```

Without a key the agent still connects, downloads and saves everything —
those files just land in `_Needs Review` unclassified. Add a key later and
press **Re-scan** on any document to classify it retroactively. The agent
never guesses a classification it could not actually read.

## Security

- The agent listens on `127.0.0.1` only. Nothing on your network can reach
  it. Every request needs a token generated at startup and written to
  `runtime/whatsapp-agent.json`.
- `whatsapp/auth/` holds the WhatsApp session itself. **Treat that folder
  like a password** — anyone who copies it can read the linked account.
  Pressing **Unlink** in the app signs this PC out and deletes it.
- Linking a device does not move the account. The phone keeps working
  normally, and you can unlink from the phone at any time under
  Settings → Linked devices.
