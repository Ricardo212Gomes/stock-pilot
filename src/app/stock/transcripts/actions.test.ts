import { beforeEach, describe, expect, it, vi } from "vitest";

const transcript = vi.fn();
vi.mock("@/lib/transcripts", async (original) => ({ ...(await original<typeof import("@/lib/transcripts")>()), getTranscript: (...args: unknown[]) => transcript(...args) }));
const gemini = vi.fn();
vi.mock("@/lib/gemini", () => ({ generateGeminiText: (...args: unknown[]) => gemini(...args) }));

const { summarizeTranscript } = await import("./actions");

const summary = { overview: "A strong quarter.", highlights: ["Revenue up 21%."], outlook: [], analystQuestions: [], tone: "positive", toneReason: "Guidance raised." };

beforeEach(() => {
  vi.stubEnv("DATABASE_URL", "");
  transcript.mockReset();
  gemini.mockReset();
});

describe("summarizeTranscript", () => {
  it("rejects bad input without calling anything", async () => {
    await expect(summarizeTranscript("<x>", "2026Q2", "X")).resolves.toMatchObject({ ok: false });
    await expect(summarizeTranscript("CRWD", "Q2", "X")).resolves.toMatchObject({ ok: false });
    expect(transcript).not.toHaveBeenCalled();
  });

  it("summarizes the server's copy of the transcript once, then reuses the summary", async () => {
    transcript.mockResolvedValue({ ok: true, segments: [{ speaker: "CEO", title: null, content: "Revenue grew 21%.", sentiment: null }] });
    gemini.mockResolvedValue({ ok: true, text: JSON.stringify(summary) });

    await expect(summarizeTranscript("crwd", "2026Q4", "CrowdStrike")).resolves.toMatchObject({ ok: true, summary: { tone: "positive" } });
    const request = gemini.mock.calls[0][0] as { prompt: string; generationConfig: { responseMimeType: string } };
    expect(request.prompt).toMatch(/^Summarize CrowdStrike's FY2026 Q4 earnings call/);
    expect(request.generationConfig.responseMimeType).toBe("application/json");

    await summarizeTranscript("CRWD", "2026Q4", "CrowdStrike");
    expect(gemini).toHaveBeenCalledTimes(1);
  });

  it("explains a missing transcript or a failed reply", async () => {
    transcript.mockResolvedValue({ ok: false, reason: "rate-limited" });
    await expect(summarizeTranscript("AAPL", "2026Q1", "Apple")).resolves.toMatchObject({ ok: false, error: expect.stringMatching(/25 requests a day/) });

    transcript.mockResolvedValue({ ok: true, segments: [{ speaker: "CEO", title: null, content: "Hi.", sentiment: null }] });
    gemini.mockResolvedValue({ ok: true, text: "not json" });
    await expect(summarizeTranscript("AAPL", "2026Q2", "Apple")).resolves.toMatchObject({ ok: false, error: expect.stringMatching(/could not be read/) });
  });
});
