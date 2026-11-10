import { describe, expect, it } from "vitest";
import { readPdfRows, rowsFromItems } from "./statement-pdf";

describe("rowsFromItems", () => {
  it("puts text at the same height on one row, top to bottom and left to right", () => {
    const rows = rowsFromItems([
      { str: "€151.20", x: 300, y: 700.4 },
      { str: "Buy", x: 200, y: 700 },
      { str: "Invest account - executed trades", x: 40, y: 740 },
      { str: "NVD", x: 100, y: 699.6 },
      { str: "  ", x: 150, y: 700 },
      { str: " Page 1 of 2 ", x: 280, y: 20 },
    ]);
    expect(rows).toEqual([["Invest account - executed trades"], ["NVD", "Buy", "€151.20"], ["Page 1 of 2"]]);
  });
});

// The smallest PDF with a page of text: each string is drawn where given, in Helvetica.
function pdfWith(lines: { text: string; x: number; y: number }[]): Uint8Array {
  const content = lines.map((line) => `BT /F1 10 Tf ${line.x} ${line.y} Td (${line.text}) Tj ET`).join("\n");
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = objects.map((object, index) => {
    const offset = pdf.length;
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
    return offset;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("")}`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(pdf);
}

describe("readPdfRows", () => {
  it("reads a PDF's text as rows of cells", async () => {
    const rows = await readPdfRows(
      pdfWith([
        { text: "Invest account - executed trades", x: 40, y: 740 },
        { text: "2026-03-02 14:31:05", x: 40, y: 700 },
        { text: "NVD", x: 160, y: 700 },
        { text: "Buy", x: 220, y: 700 },
      ]),
    );
    expect(rows).toEqual([["Invest account - executed trades"], ["2026-03-02 14:31:05", "NVD", "Buy"]]);
  });

  it("throws for a file that isn't a PDF", async () => {
    await expect(readPdfRows(new TextEncoder().encode("%PDF-1.4\nnot really"))).rejects.toThrow();
  });
});
