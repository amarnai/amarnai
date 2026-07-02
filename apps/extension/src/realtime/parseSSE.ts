// Minimal incremental Server-Sent Events parser. The panel consumes the SSE
// stream via fetch + ReadableStream (EventSource cannot send an Authorization
// header), so it must frame events itself. Feed it decoded text chunks; it
// buffers partial records across chunk boundaries and returns the events that
// completed in this chunk.
//
// Only the fields the workspace-events stream uses are parsed (`event:` and
// `data:`). Records are separated by a blank line; CRLF and LF are both
// tolerated. Comment lines (starting with `:`, e.g. heartbeat padding) are
// ignored.

export type SSEEvent = { event: string; data: string };

export class SSEParser {
  private buffer = "";

  // Push a decoded chunk; returns any events that completed within it.
  push(chunk: string): SSEEvent[] {
    this.buffer += chunk.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
    const events: SSEEvent[] = [];

    let sep: number;
    while ((sep = this.buffer.indexOf("\n\n")) !== -1) {
      const record = this.buffer.slice(0, sep);
      this.buffer = this.buffer.slice(sep + 2);
      const parsed = parseRecord(record);
      if (parsed) events.push(parsed);
    }
    return events;
  }
}

function parseRecord(record: string): SSEEvent | null {
  let event = "message";
  const dataLines: string[] = [];
  for (const rawLine of record.split("\n")) {
    if (rawLine === "" || rawLine.startsWith(":")) continue;
    const colon = rawLine.indexOf(":");
    const field = colon === -1 ? rawLine : rawLine.slice(0, colon);
    // Per the SSE spec, a single leading space after the colon is stripped.
    let value = colon === -1 ? "" : rawLine.slice(colon + 1);
    if (value.startsWith(" ")) value = value.slice(1);
    if (field === "event") event = value;
    else if (field === "data") dataLines.push(value);
  }
  if (dataLines.length === 0 && event === "message") return null;
  return { event, data: dataLines.join("\n") };
}
