import { config } from "../config";
import type { ToolDef } from "./types";

// Web search via Tavily (https://tavily.com — free tier available).
// Only registered when TAVILY_API_KEY is set; see tools/registry.ts.
export const webSearch: ToolDef = {
  name: "web_search",
  description:
    "Search the public web for current information that is not in the store's own systems, e.g. carrier service disruptions, weather affecting delivery, or general product questions.",
  parameters: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description: "The search query",
      },
    },
    required: ["query"],
  },
  async execute(args) {
    const res = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.tavilyKey}`,
      },
      body: JSON.stringify({ query: String(args.query ?? ""), max_results: 5, include_answer: true }),
    });
    if (!res.ok) {
      return { error: `Web search failed (${res.status})` };
    }
    const json = (await res.json()) as {
      answer?: string;
      results?: { title: string; url: string; content: string }[];
    };
    return {
      answer: json.answer,
      results: (json.results ?? []).map((r) => ({
        title: r.title,
        url: r.url,
        snippet: r.content?.slice(0, 300),
      })),
    };
  },
};
