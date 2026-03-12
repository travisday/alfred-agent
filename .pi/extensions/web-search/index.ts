import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";

const TAVILY_SEARCH_URL = "https://api.tavily.com/search";
const TAVILY_EXTRACT_URL = "https://api.tavily.com/extract";

type SearchDepth = "basic" | "advanced";
type SearchTopic = "general" | "news";
type TimeRange = "day" | "week" | "month" | "year";
type ExtractDepth = "basic" | "advanced";

interface TavilySearchResult {
  title?: string;
  url?: string;
  content?: string;
  raw_content?: string;
  score?: number;
  published_date?: string;
}

interface TavilySearchResponse {
  results?: TavilySearchResult[];
  query?: string;
  answer?: string;
  response_time?: number;
}

interface TavilyExtractResult {
  url?: string;
  title?: string;
  content?: string;
  raw_content?: string;
}

interface TavilyExtractResponse {
  results?: TavilyExtractResult[];
}

function getApiKey(): string | null {
  const key = process.env.TAVILY_API_KEY?.trim();
  return key && key.length > 0 ? key : null;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return `${text.slice(0, maxLen).trimEnd()}...`;
}

function cleanText(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.replace(/\s+/g, " ").trim();
}

async function callTavilySearch(
  apiKey: string,
  {
    query,
    maxResults,
    searchDepth,
    topic,
    timeRange,
    includeRawContent,
  }: {
    query: string;
    maxResults: number;
    searchDepth: SearchDepth;
    topic: SearchTopic;
    timeRange?: TimeRange;
    includeRawContent: boolean;
  },
  signal?: AbortSignal
): Promise<TavilySearchResponse> {
  const response = await fetch(TAVILY_SEARCH_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      api_key: apiKey,
      query,
      search_depth: searchDepth,
      topic,
      max_results: maxResults,
      include_answer: false,
      include_raw_content: includeRawContent,
      time_range: timeRange,
    }),
    signal,
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Tavily search failed (${response.status}): ${errorText}`);
  }

  return (await response.json()) as TavilySearchResponse;
}

async function callTavilyExtract(
  apiKey: string,
  urls: string[],
  extractDepth: ExtractDepth,
  signal?: AbortSignal
): Promise<Map<string, string>> {
  if (urls.length === 0) return new Map<string, string>();
  const response = await fetch(TAVILY_EXTRACT_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      api_key: apiKey,
      urls,
      extract_depth: extractDepth,
    }),
    signal,
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Tavily extract failed (${response.status}): ${errorText}`);
  }

  const payload = (await response.json()) as TavilyExtractResponse;
  const byUrl = new Map<string, string>();
  for (const row of payload.results ?? []) {
    const url = cleanText(row.url);
    if (!url) continue;
    const text = cleanText(row.content || row.raw_content);
    if (text) byUrl.set(url, text);
  }
  return byUrl;
}

function formatResultsMarkdown(
  query: string,
  results: TavilySearchResult[],
  extractedByUrl: Map<string, string>
): string {
  const lines: string[] = [];
  lines.push(`Web search results for: "${query}"`);
  lines.push("");

  results.forEach((result, i) => {
    const title = cleanText(result.title) || "Untitled";
    const url = cleanText(result.url) || "";
    const snippet = cleanText(result.content);
    const raw = cleanText(result.raw_content);
    const extracted = url ? extractedByUrl.get(url) : undefined;
    const published = cleanText(result.published_date);

    lines.push(`${i + 1}. ${url ? `[${title}](${url})` : title}`);
    if (published) lines.push(`   Published: ${published}`);
    if (snippet) lines.push(`   Snippet: ${truncate(snippet, 420)}`);
    if (!snippet && raw) lines.push(`   Snippet: ${truncate(raw, 420)}`);
    if (extracted) lines.push(`   PageContent: ${truncate(extracted, 700)}`);
    lines.push("");
  });

  lines.push("Use these sources to answer with concise, cited claims.");
  return lines.join("\n").trim();
}

export default function webSearchExtension(pi: ExtensionAPI) {
  const configured = Boolean(getApiKey());
  pi.on("session_start", async (_event, ctx) => {
    if (!configured) {
      ctx.ui.notify(
        "Web search extension loaded but TAVILY_API_KEY is not set.",
        "warn"
      );
    }
  });

  pi.registerTool({
    name: "web_search",
    label: "Web Search",
    description:
      "Search the live web for current information and return source links with snippets. Use this when freshness matters.",
    promptSnippet:
      "web_search: Retrieve up-to-date web sources with snippets and citations.",
    parameters: Type.Object({
      query: Type.String({
        description: "What to search for on the web.",
      }),
      max_results: Type.Optional(
        Type.Number({
          description: "Number of results to return (1-10, default 5).",
          minimum: 1,
          maximum: 10,
          default: 5,
        })
      ),
      search_depth: Type.Optional(
        Type.Union([Type.Literal("basic"), Type.Literal("advanced")], {
          description: "Search depth. Use basic by default to keep costs low.",
          default: "basic",
        })
      ),
      topic: Type.Optional(
        Type.Union([Type.Literal("general"), Type.Literal("news")], {
          description: "Search topic type.",
          default: "general",
        })
      ),
      time_range: Type.Optional(
        Type.Union(
          [
            Type.Literal("day"),
            Type.Literal("week"),
            Type.Literal("month"),
            Type.Literal("year"),
          ],
          {
            description: "Optional freshness filter.",
          }
        )
      ),
      include_page_content: Type.Optional(
        Type.Boolean({
          description:
            "If true, fetch and include deeper page content from top results.",
          default: false,
        })
      ),
      extract_depth: Type.Optional(
        Type.Union([Type.Literal("basic"), Type.Literal("advanced")], {
          description:
            "Extraction depth for page content fetches. Only used when include_page_content is true.",
          default: "basic",
        })
      ),
    }),
    async execute(_toolCallId, params, signal, onUpdate) {
      const apiKey = getApiKey();
      if (!apiKey) {
        return {
          content: [
            {
              type: "text",
              text: "Error: TAVILY_API_KEY is not set. Add it to the environment to enable web search.",
            },
          ],
          isError: true,
        };
      }

      const query = cleanText(params.query);
      if (!query) {
        return {
          content: [{ type: "text", text: "Error: query cannot be empty." }],
          isError: true,
        };
      }

      const maxResults = clamp(
        Number.isFinite(params.max_results) ? params.max_results : 5,
        1,
        10
      );
      const searchDepth: SearchDepth = params.search_depth === "advanced" ? "advanced" : "basic";
      const topic: SearchTopic = params.topic === "news" ? "news" : "general";
      const timeRange: TimeRange | undefined =
        params.time_range === "day" ||
        params.time_range === "week" ||
        params.time_range === "month" ||
        params.time_range === "year"
          ? params.time_range
          : undefined;
      const includePageContent = params.include_page_content === true;
      const extractDepth: ExtractDepth = params.extract_depth === "advanced" ? "advanced" : "basic";

      onUpdate?.({
        content: [{ type: "text", text: "Searching the web..." }],
        details: { query, max_results: maxResults, search_depth: searchDepth, topic },
      });

      try {
        const search = await callTavilySearch(
          apiKey,
          {
            query,
            maxResults,
            searchDepth,
            topic,
            timeRange,
            includeRawContent: includePageContent,
          },
          signal
        );

        const results = (search.results ?? []).slice(0, maxResults);
        if (results.length === 0) {
          return {
            content: [{ type: "text", text: `No web results found for "${query}".` }],
            details: { provider: "tavily", query, result_count: 0 },
          };
        }

        const urlsForExtraction = includePageContent
          ? results
              .map((r) => cleanText(r.url))
              .filter(Boolean)
              .slice(0, Math.min(3, maxResults))
          : [];

        let extractedByUrl = new Map<string, string>();
        if (urlsForExtraction.length > 0) {
          onUpdate?.({
            content: [{ type: "text", text: "Extracting page content from top sources..." }],
            details: { query, extract_count: urlsForExtraction.length, extract_depth: extractDepth },
          });
          extractedByUrl = await callTavilyExtract(
            apiKey,
            urlsForExtraction,
            extractDepth,
            signal
          );
        }

        const markdown = formatResultsMarkdown(query, results, extractedByUrl);
        return {
          content: [{ type: "text", text: markdown }],
          details: {
            provider: "tavily",
            query,
            result_count: results.length,
            max_results: maxResults,
            search_depth: searchDepth,
            topic,
            extracted_count: extractedByUrl.size,
          },
        };
      } catch (error) {
        if (signal?.aborted) {
          return {
            content: [{ type: "text", text: "Web search cancelled." }],
            details: { cancelled: true, query },
          };
        }
        const message = error instanceof Error ? error.message : String(error);
        return {
          content: [{ type: "text", text: `Web search error: ${message}` }],
          details: { error: true, message, query },
          isError: true,
        };
      }
    },
  });
}
