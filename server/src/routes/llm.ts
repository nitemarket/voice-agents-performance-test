import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { resolve } from "../pipeline/registry";
import type { ChatMessage, LlmToolCall, ToolSpec } from "../pipeline/types";
import { availableTools } from "../tools/registry";
import type { ToolDef } from "../tools/types";
import { SUPPORT_AGENT_PROMPT } from "../prompt";

const MAX_TOOL_ROUNDS = 6;

interface LlmBody {
  messages: ChatMessage[];
  provider: string;
  option: string;
}

function withSystem(messages: ChatMessage[]): ChatMessage[] {
  return [{ role: "system", content: SUPPORT_AGENT_PROMPT }, ...messages];
}

function toolSpecs(tools: ToolDef[]): ToolSpec[] {
  return tools.map((t) => ({
    type: "function",
    function: { name: t.name, description: t.description, parameters: t.parameters },
  }));
}

async function executeCall(tools: ToolDef[], call: LlmToolCall): Promise<unknown> {
  const tool = tools.find((t) => t.name === call.name);
  try {
    return tool
      ? await tool.execute(JSON.parse(call.arguments || "{}"))
      : { error: `Unknown tool: ${call.name}` };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

function pushToolRound(convo: ChatMessage[], text: string, calls: LlmToolCall[]) {
  convo.push({
    role: "assistant",
    content: text || null,
    tool_calls: calls.map((c) => ({
      id: c.id,
      type: "function",
      function: { name: c.name, arguments: c.arguments },
    })),
  });
}

export const llmRoute = new Hono()
  .post("/llm", async (c) => {
    const body = (await c.req.json()) as LlmBody;
    const { impl, option } = resolve("llm", body.provider, body.option);
    const tools = availableTools();
    const specs = toolSpecs(tools);
    const convo = withSystem(body.messages);
    const toolsUsed: string[] = [];
    const t0 = performance.now();
    let text = "";
    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      const res = await impl.chat(convo, option.model, specs);
      if (!res.toolCalls?.length) {
        text = res.text;
        break;
      }
      pushToolRound(convo, res.text, res.toolCalls);
      for (const call of res.toolCalls) {
        toolsUsed.push(call.name);
        convo.push({
          role: "tool",
          content: JSON.stringify(await executeCall(tools, call)),
          tool_call_id: call.id,
        });
      }
    }
    return c.json({ text, ms: Math.round(performance.now() - t0), tools: toolsUsed });
  })
  // Streaming variant: SSE events of {delta} tokens, {tool} activity while a
  // tool round executes, then a final {done, ms}.
  .post("/llm/stream", async (c) => {
    const body = (await c.req.json()) as LlmBody;
    const { impl, option } = resolve("llm", body.provider, body.option);
    const tools = availableTools();
    const specs = toolSpecs(tools);
    return streamSSE(c, async (stream) => {
      const send = (data: unknown) => stream.writeSSE({ data: JSON.stringify(data) });
      const t0 = performance.now();
      const convo = withSystem(body.messages);
      let callSeq = 0;
      try {
        for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
          let roundText = "";
          let toolCalls: LlmToolCall[] | null = null;
          for await (const item of impl.chatStream(convo, option.model, specs)) {
            if (item.type === "delta") {
              roundText += item.text;
              await send({ delta: item.text });
            } else {
              toolCalls = item.calls;
            }
          }
          if (!toolCalls?.length) break;
          pushToolRound(convo, roundText, toolCalls);
          for (const call of toolCalls) {
            const id = `${call.name}-${++callSeq}`;
            await send({ tool: { id, name: call.name, status: "running", args: call.arguments } });
            const result = await executeCall(tools, call);
            await send({ tool: { id, name: call.name, status: "done" } });
            convo.push({
              role: "tool",
              content: JSON.stringify(result),
              tool_call_id: call.id,
            });
          }
        }
        await send({ done: true, ms: Math.round(performance.now() - t0) });
      } catch (err) {
        await send({ error: err instanceof Error ? err.message : String(err) });
      }
    });
  });
