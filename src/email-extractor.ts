import { App, TFile } from 'obsidian';

export interface EmailExtractedMetadata {
  subject: string;
  from: string;
  date: string | null;
}

const EMPTY: EmailExtractedMetadata = { subject: "", from: "", date: null };

function decodeBytes(bytes: Uint8Array, charset: string): string {
  try {
    return new TextDecoder(charset.toLowerCase()).decode(bytes);
  } catch {
    return new TextDecoder('utf-8').decode(bytes);
  }
}

/** Decodes RFC 2047 encoded words, e.g. =?UTF-8?B?...?= or =?utf-8?Q?...?= */
export function decodeMimeWords(value: string): string {
  return value
    .replace(/\?=\s+=\?/g, '?==?')
    .replace(/=\?([^?]+)\?([bBqQ])\?([^?]*)\?=/g, (_m, charset: string, enc: string, text: string) => {
      try {
        if (enc.toUpperCase() === 'B') {
          const bin = atob(text);
          return decodeBytes(Uint8Array.from(bin, c => c.charCodeAt(0)), charset);
        }
        const q = text.replace(/_/g, ' ');
        const bytes: number[] = [];
        for (let i = 0; i < q.length; i++) {
          if (q[i] === '=' && /^[0-9a-fA-F]{2}$/.test(q.slice(i + 1, i + 3))) {
            bytes.push(parseInt(q.slice(i + 1, i + 3), 16));
            i += 2;
          } else {
            bytes.push(q.charCodeAt(i));
          }
        }
        return decodeBytes(Uint8Array.from(bytes), charset);
      } catch {
        return text;
      }
    });
}

/** Parses the header block of an RFC 5322 message into a lowercase-keyed map. */
export function parseHeaders(raw: string): Record<string, string> {
  const headerBlock = raw.split(/\r?\n\r?\n/, 1)[0];
  const unfolded = headerBlock.replace(/\r?\n[ \t]+/g, ' ');
  const headers: Record<string, string> = {};
  for (const line of unfolded.split(/\r?\n/)) {
    const idx = line.indexOf(':');
    if (idx <= 0) continue;
    const key = line.slice(0, idx).trim().toLowerCase();
    if (!(key in headers)) headers[key] = line.slice(idx + 1).trim();
  }
  return headers;
}

/** "Jane Doe <jane@x.com>" -> "Jane Doe"; "jane@x.com" -> "jane@x.com" */
function displayName(from: string): string {
  const decoded = decodeMimeWords(from);
  const match = decoded.match(/^\s*"?([^"<]*?)"?\s*<([^>]*)>/);
  if (match) return match[1].trim() || match[2].trim();
  return decoded.trim();
}

export class EmailMetadataExtractor {
  constructor(private app: App) {}

  async extract(file: TFile): Promise<EmailExtractedMetadata> {
    try {
      const buffer = await this.app.vault.readBinary(file);
      const raw = new TextDecoder('utf-8').decode(new Uint8Array(buffer, 0, Math.min(buffer.byteLength, 65536)));
      const headers = parseHeaders(raw);

      const parsedDate = headers['date'] ? new Date(headers['date']) : null;
      const date = parsedDate && !isNaN(parsedDate.getTime())
        ? parsedDate.toISOString().split('T')[0]
        : null;

      return {
        subject: decodeMimeWords(headers['subject'] ?? "").trim(),
        from: displayName(headers['from'] ?? ""),
        date,
      };
    } catch (err) {
      console.warn(`[Attachments Library] Could not extract email metadata from ${file.path}:`, err);
      return { ...EMPTY };
    }
  }
}
