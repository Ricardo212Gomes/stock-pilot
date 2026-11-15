import { describe, expect, it } from "vitest";
import { decodeRk, readXls } from "./xls";

// Builds a small .xls in memory: BIFF8 records in a "Workbook" stream, inside an OLE2 compound file with 512-byte
// sectors (sector 0 the FAT, 1 the directory, then the stream).

function record(type: number, data: number[]): number[] {
  return [type & 0xff, type >> 8, data.length & 0xff, data.length >> 8, ...data];
}
const u16 = (value: number) => [value & 0xff, (value >> 8) & 0xff];
const u32 = (value: number) => [value & 0xff, (value >> 8) & 0xff, (value >> 16) & 0xff, (value >>> 24) & 0xff];
const f64 = (value: number) => [...new Uint8Array(new Float64Array([value]).buffer)];
const ascii = (text: string) => [...text].map((char) => char.charCodeAt(0));
const cell = (row: number, column: number) => [...u16(row), ...u16(column), ...u16(15)];

function workbook(): number[] {
  // Shared strings, with "Rate GS10" split across the SST and a CONTINUE record (which restarts with a flags byte).
  const strings = ["Date", "P", "E", "Rate GS10", "CAPE"];
  const head = [...u32(strings.length), ...u32(strings.length)];
  const body: number[] = [];
  for (const text of strings.slice(0, 3)) body.push(...u16(text.length), 0, ...ascii(text));
  const sst = [...head, ...body, ...u16(9), 0, ...ascii("Rate")];
  const rest = [0, ...ascii(" GS10"), ...u16(4), 0, ...ascii("CAPE")];

  const sheet = [
    ...record(0x0809, [0, 6, 0x10, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
    ...[0, 1, 2, 3, 4].flatMap((column) => record(0x00fd, [...cell(0, column), ...u32(column)])),
    ...record(0x0203, [...cell(1, 0), ...f64(2026.01)]),
    // An RK integer (6900 × 4 + 2) and a MULRK with an RK divided by 100 (24855 → 248.55).
    ...record(0x027e, [...cell(1, 1), ...u32(6900 * 4 + 2)]),
    ...record(0x00bd, [...u16(1), ...u16(2), ...u16(15), ...u32(24855 * 4 + 3), ...u16(15), ...u32(4 * 4 + 2), ...u16(3)]),
    // A formula with a number result, and one with a text result in the STRING record after it.
    ...record(0x0006, [...cell(1, 4), ...f64(39.64), 0, 0, 0, 0, 0, 0]),
    ...record(0x0006, [...cell(2, 4), 0, 0, 0, 0, 0, 0, 0xff, 0xff, 0, 0, 0, 0, 0, 0]),
    ...record(0x0207, [...u16(2), 0, ...ascii("NA")]),
    ...record(0x000a, []),
  ];
  const globalsWithoutSheet = (offset: number) => [
    ...record(0x0809, [0, 6, 5, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
    ...record(0x0085, [...u32(offset), 0, 0, 4, 0, ...ascii("Data")]),
    ...record(0x00fc, sst),
    ...record(0x003c, rest),
    ...record(0x000a, []),
  ];
  const globalsLength = globalsWithoutSheet(0).length;
  // Filler (an unknown record type) after the sheet, so the stream is past the 4096-byte mini-stream cutoff.
  return [...globalsWithoutSheet(globalsLength), ...sheet, ...record(0x00e1, new Array(5000).fill(0))];
}

function compoundFile(stream: number[]): Uint8Array {
  const sectors = Math.ceil(stream.length / 512);
  const file = new Uint8Array(512 * (3 + sectors));
  const view = new DataView(file.buffer);
  file.set([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
  view.setUint16(0x18, 0x3e, true);
  view.setUint16(0x1a, 3, true);
  view.setUint16(0x1c, 0xfffe, true);
  view.setUint16(0x1e, 9, true);
  view.setUint16(0x20, 6, true);
  view.setUint32(0x2c, 1, true);
  view.setUint32(0x30, 1, true);
  view.setUint32(0x38, 4096, true);
  view.setUint32(0x3c, 0xfffffffe, true);
  view.setUint32(0x44, 0xfffffffe, true);
  for (let index = 0; index < 109; index++) view.setUint32(0x4c + index * 4, index === 0 ? 0 : 0xffffffff, true);
  // FAT: sector 0 is the FAT itself, 1 the directory, then the stream's chain.
  const fat = 512;
  for (let index = 0; index < 128; index++) view.setUint32(fat + index * 4, 0xffffffff, true);
  view.setUint32(fat, 0xfffffffd, true);
  view.setUint32(fat + 4, 0xfffffffe, true);
  for (let index = 0; index < sectors; index++) view.setUint32(fat + (2 + index) * 4, index === sectors - 1 ? 0xfffffffe : 3 + index, true);
  // Directory: the root entry and the Workbook stream.
  const dir = 1024;
  const entry = (at: number, name: string, type: number, start: number, size: number) => {
    [...name].forEach((char, index) => view.setUint16(at + index * 2, char.charCodeAt(0), true));
    view.setUint16(at + 0x40, (name.length + 1) * 2, true);
    view.setUint8(at + 0x42, type);
    view.setUint32(at + 0x74, start, true);
    view.setUint32(at + 0x78, size, true);
  };
  entry(dir, "Root Entry", 5, 0xfffffffe, 0);
  entry(dir + 128, "Workbook", 2, 2, stream.length);
  file.set(stream, 512 * 3);
  return file;
}

describe("readXls", () => {
  it("reads sheet names, shared strings across CONTINUE, numbers, RKs and formula results", () => {
    const [sheet] = readXls(compoundFile(workbook()));
    expect(sheet.name).toBe("Data");
    expect(sheet.rows[0]).toEqual(["Date", "P", "E", "Rate GS10", "CAPE"]);
    expect(sheet.rows[1]).toEqual([2026.01, 6900, 248.55, 4, 39.64]);
    expect(sheet.rows[2][4]).toBe("NA");
  });

  it("rejects a file that isn't an .xls", () => {
    expect(() => readXls(new TextEncoder().encode("<html>not a spreadsheet</html>".padEnd(600)))).toThrow(/Not an \.xls/);
  });

  it("decodes RK numbers", () => {
    expect(decodeRk(6900 * 4 + 2)).toBe(6900);
    expect(decodeRk(24855 * 4 + 3)).toBe(248.55);
    // A double's top 30 bits: 1.5 is 0x3FF80000 in the high word.
    expect(decodeRk(0x3ff80000)).toBe(1.5);
  });
});
