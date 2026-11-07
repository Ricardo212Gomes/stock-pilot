"use server";

import { scanNewsForEvents, type NewsEventsResult } from "@/lib/news-events";

// Takes nothing from the browser: the headlines are fetched on the server, so the prompt only ever
// contains the news.
export async function findNewsEvents(): Promise<NewsEventsResult> {
  return scanNewsForEvents();
}
