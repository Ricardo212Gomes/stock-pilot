// A small reader for old-format Excel files (.xls, BIFF8 inside an OLE2 compound file), enough for Robert Shiller's
// dataset: sheet names, and each cell's number or text (a formula gives its last computed value). No formatting,
// dates are left as the numbers Excel stores. Written here rather than adding a spreadsheet library for one file.

export type XlsCell = number | string;
// Rows and columns from 0; empty cells are missing.
export type XlsSheet = { name: string; rows: XlsCell[][] };

const END_OF_CHAIN = 0xfffffffe;
const FREE_SECT = 0xffffffff;
const SIGNATURE = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];

class XlsError extends Error {}

// The bytes of the "Workbook" stream (or the older "Book") from the compound file.
export function workbookStream(file: Uint8Array): Uint8Array {
  if (file.length < 512 || SIGNATURE.some((byte, index) => file[index] !== byte)) throw new XlsError("Not an .xls file.");
  const view = new DataView(file.buffer, file.byteOffset, file.byteLength);
  const sectorSize = 1 << view.getUint16(0x1e, true);
  const miniSectorSize = 1 << view.getUint16(0x20, true);
  const fatSectorCount = view.getUint32(0x2c, true);
  const firstDirSector = view.getUint32(0x30, true);
  const miniCutoff = view.getUint32(0x38, true);
  const firstMiniFatSector = view.getUint32(0x3c, true);
  let difatSector = view.getUint32(0x44, true);

  const sectorOffset = (sector: number) => 512 + sector * sectorSize;
  const u32 = (offset: number) => (offset + 4 <= file.length ? view.getUint32(offset, true) : FREE_SECT);

  // The sectors that hold the FAT: 109 listed in the header, the rest in a chain of DIFAT sectors.
  const fatSectors: number[] = [];
  for (let index = 0; index < 109 && fatSectors.length < fatSectorCount; index++) fatSectors.push(u32(0x4c + index * 4));
  for (let guard = 0; fatSectors.length < fatSectorCount && difatSector < END_OF_CHAIN && guard < 10_000; guard++) {
    const base = sectorOffset(difatSector);
    for (let index = 0; index < sectorSize / 4 - 1 && fatSectors.length < fatSectorCount; index++) fatSectors.push(u32(base + index * 4));
    difatSector = u32(base + sectorSize - 4);
  }
  const perSector = sectorSize / 4;
  const fat = (sector: number) => u32(sectorOffset(fatSectors[Math.floor(sector / perSector)] ?? FREE_SECT) + (sector % perSector) * 4);

  const chain = (start: number, next: (sector: number) => number): number[] => {
    const sectors: number[] = [];
    for (let sector = start; sector < END_OF_CHAIN; sector = next(sector)) {
      if (sectors.length > file.length / 64) throw new XlsError("A sector chain loops.");
      sectors.push(sector);
    }
    return sectors;
  };
  const readChain = (start: number, size?: number): Uint8Array => {
    const sectors = chain(start, fat);
    const out = new Uint8Array(sectors.length * sectorSize);
    sectors.forEach((sector, index) => out.set(file.subarray(sectorOffset(sector), sectorOffset(sector) + sectorSize), index * sectorSize));
    return size === undefined ? out : out.subarray(0, size);
  };

  const directory = readChain(firstDirSector);
  const dir = new DataView(directory.buffer, directory.byteOffset, directory.byteLength);
  type Entry = { name: string; type: number; start: number; size: number };
  const entries: Entry[] = [];
  for (let offset = 0; offset + 128 <= directory.length; offset += 128) {
    const nameBytes = dir.getUint16(offset + 0x40, true);
    let name = "";
    for (let index = 0; index + 2 < nameBytes && index < 64; index += 2) name += String.fromCharCode(dir.getUint16(offset + index, true));
    entries.push({ name, type: dir.getUint8(offset + 0x42), start: dir.getUint32(offset + 0x74, true), size: dir.getUint32(offset + 0x78, true) });
  }
  const root = entries.find((entry) => entry.type === 5);
  const stream = entries.find((entry) => entry.type === 2 && (entry.name === "Workbook" || entry.name === "Book"));
  if (!root || !stream) throw new XlsError("The file has no workbook.");
  if (stream.size >= miniCutoff) return readChain(stream.start, stream.size);

  // Small streams live in the mini stream, 64-byte sectors inside the root entry's data.
  const miniStream = readChain(root.start, root.size);
  const miniFat = readChain(firstMiniFatSector);
  const miniView = new DataView(miniFat.buffer, miniFat.byteOffset, miniFat.byteLength);
  const sectors = chain(stream.start, (sector) => (sector * 4 + 4 <= miniFat.length ? miniView.getUint32(sector * 4, true) : END_OF_CHAIN));
  const out = new Uint8Array(sectors.length * miniSectorSize);
  sectors.forEach((sector, index) => out.set(miniStream.subarray(sector * miniSectorSize, (sector + 1) * miniSectorSize), index * miniSectorSize));
  return out.subarray(0, stream.size);
}

type BiffRecord = { type: number; offset: number; data: Uint8Array };

function* records(stream: Uint8Array, from = 0): Generator<BiffRecord> {
  const view = new DataView(stream.buffer, stream.byteOffset, stream.byteLength);
  for (let offset = from; offset + 4 <= stream.length; ) {
    const type = view.getUint16(offset, true);
    const length = view.getUint16(offset + 2, true);
    yield { type, offset, data: stream.subarray(offset + 4, offset + 4 + length) };
    offset += 4 + length;
  }
}

// Reads strings that may continue across CONTINUE records: each continuation of a string's characters starts with a
// new flags byte saying whether they're one or two bytes each.
class Reader {
  private part = 0;
  private position = 0;
  constructor(private readonly parts: Uint8Array[]) {}

  private current(): Uint8Array {
    while (this.part < this.parts.length && this.position >= this.parts[this.part].length) {
      this.part += 1;
      this.position = 0;
    }
    if (this.part >= this.parts.length) throw new XlsError("A string runs past its record.");
    return this.parts[this.part];
  }
  byte(): number {
    return this.current()[this.position++];
  }
  u16(): number {
    return this.byte() | (this.byte() << 8);
  }
  u32(): number {
    return (this.u16() | (this.u16() << 16)) >>> 0;
  }
  skip(count: number) {
    for (let left = count; left > 0; ) {
      const part = this.current();
      const step = Math.min(left, part.length - this.position);
      this.position += step;
      left -= step;
    }
  }
  chars(count: number, wide: boolean): string {
    let text = "";
    let twoBytes = wide;
    for (let index = 0; index < count; index++) {
      if (this.position >= (this.parts[this.part]?.length ?? 0)) {
        this.current();
        twoBytes = (this.byte() & 1) === 1;
      }
      text += String.fromCharCode(twoBytes ? this.u16() : this.byte());
    }
    return text;
  }
  // An XLUnicodeRichExtendedString (SST entries and two-byte-length strings).
  string(lengthBytes: 1 | 2 = 2): string {
    const count = lengthBytes === 1 ? this.byte() : this.u16();
    const flags = this.byte();
    const runs = flags & 0x08 ? this.u16() : 0;
    const extra = flags & 0x04 ? this.u32() : 0;
    const text = this.chars(count, (flags & 1) === 1);
    this.skip(runs * 4 + extra);
    return text;
  }
}

// An RK value: a number packed in 30 bits, as an integer or the top of a double, maybe divided by 100.
export function decodeRk(rk: number): number {
  let value: number;
  if (rk & 2) {
    value = rk >> 2;
  } else {
    const bytes = new DataView(new ArrayBuffer(8));
    bytes.setUint32(4, rk & 0xfffffffc, true);
    value = bytes.getFloat64(0, true);
  }
  return rk & 1 ? value / 100 : value;
}

export function readXls(file: Uint8Array): XlsSheet[] {
  const stream = workbookStream(file);
  const sheets: { name: string; offset: number }[] = [];
  let strings: string[] = [];

  // The workbook globals: the sheet list and the shared strings, up to the first EOF.
  const globals = [...records(stream)];
  for (let index = 0; index < globals.length; index++) {
    const record = globals[index];
    if (record.type === 0x000a) break;
    const view = new DataView(record.data.buffer, record.data.byteOffset, record.data.byteLength);
    if (record.type === 0x0085) {
      const reader = new Reader([record.data.subarray(6)]);
      // Worksheets only (type 0), not charts or macros.
      if (record.data[5] === 0) sheets.push({ name: reader.string(1), offset: view.getUint32(0, true) });
    } else if (record.type === 0x00fc) {
      const parts = [record.data.subarray(8)];
      for (let next = index + 1; globals[next]?.type === 0x003c; next++) parts.push(globals[next].data);
      const reader = new Reader(parts);
      const unique = view.getUint32(4, true);
      strings = [];
      for (let count = 0; count < unique; count++) strings.push(reader.string());
    }
  }

  return sheets.map(({ name, offset }) => {
    const rows: XlsCell[][] = [];
    const set = (row: number, column: number, value: XlsCell) => {
      (rows[row] ??= [])[column] = value;
    };
    let pendingFormula: [number, number] | null = null;
    for (const record of records(stream, offset)) {
      const data = record.data;
      const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
      const row = data.length >= 4 ? view.getUint16(0, true) : 0;
      const column = data.length >= 4 ? view.getUint16(2, true) : 0;
      if (record.type === 0x000a && record.offset !== offset) break;
      switch (record.type) {
        case 0x0203: // NUMBER
          set(row, column, view.getFloat64(6, true));
          break;
        case 0x027e: // RK
          set(row, column, decodeRk(view.getUint32(6, true)));
          break;
        case 0x00bd: {
          // MULRK: several RK cells along a row.
          const count = (data.length - 6) / 6;
          for (let index = 0; index < count; index++) set(row, column + index, decodeRk(view.getUint32(4 + index * 6 + 2, true)));
          break;
        }
        case 0x00fd: // LABELSST
          set(row, column, strings[view.getUint32(6, true)] ?? "");
          break;
        case 0x0204: // LABEL
          set(row, column, new Reader([data.subarray(6)]).string());
          break;
        case 0x0006: {
          // FORMULA: a number, or 0xFFFF in the top bytes when its text result follows in a STRING record.
          if (view.getUint16(12, true) !== 0xffff) set(row, column, view.getFloat64(6, true));
          else if (data[6] === 0) pendingFormula = [row, column];
          break;
        }
        case 0x0207: // STRING, the text result of the formula before it
          if (pendingFormula) set(pendingFormula[0], pendingFormula[1], new Reader([data]).string());
          pendingFormula = null;
          break;
      }
    }
    return { name, rows };
  });
}
