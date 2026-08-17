import { config } from "../config";
import type { ToolDef } from "./types";
import { getOrderStatus } from "./orders";
import { searchKnowledgeBase } from "./knowledgeBase";
import { webSearch } from "./webSearch";

// To add a tool: implement ToolDef in one file, add it here.
export function availableTools(): ToolDef[] {
  const tools: ToolDef[] = [getOrderStatus, searchKnowledgeBase];
  if (config.tavilyKey) tools.push(webSearch);
  return tools;
}
