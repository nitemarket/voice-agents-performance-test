import type { ToolDef } from "./types";

// RAG-lite: a small in-memory knowledge base with keyword-overlap retrieval.
// Swap the DOCS array + score() for an embedding store to make this real RAG.
const DOCS = [
  {
    title: "Returns & refunds policy",
    text: "Items can be returned within 30 days of delivery for a full refund. Products must be unused and in original packaging. Refunds are issued to the original payment method within 5 business days of us receiving the return. Sale items are final sale and cannot be returned. To start a return, customers need their order number.",
  },
  {
    title: "Shipping options and times",
    text: "Standard shipping is free over $50 and takes 3 to 5 business days. Express shipping costs $12 and takes 1 to 2 business days. We ship Monday through Friday. Orders placed before 2pm Eastern ship the same day. We currently ship to the US and Canada only.",
  },
  {
    title: "Warranty",
    text: "All gear carries a 2-year warranty against manufacturing defects. The warranty does not cover normal wear and tear or damage from misuse. Warranty claims require proof of purchase and photos of the defect, submitted via support@acmeoutfitters.example.",
  },
  {
    title: "Support hours and contact",
    text: "Phone support is available Monday to Friday, 9am to 6pm Eastern. Outside those hours customers can email support@acmeoutfitters.example or use live chat on the website. Average email response time is under 12 hours.",
  },
  {
    title: "Order changes and cancellations",
    text: "Orders can be modified or cancelled while their status is still 'processing'. Once an order has shipped it can no longer be changed, but it can be returned after delivery under the returns policy.",
  },
];

function tokenize(s: string): string[] {
  return s.toLowerCase().split(/\W+/).filter((w) => w.length > 2);
}

function score(queryTokens: string[], doc: (typeof DOCS)[number]): number {
  const docTokens = new Set(tokenize(`${doc.title} ${doc.text}`));
  return queryTokens.filter((t) => docTokens.has(t)).length;
}

export const searchKnowledgeBase: ToolDef = {
  name: "search_knowledge_base",
  description:
    "Search the store's internal knowledge base for policies and procedures: returns, refunds, shipping, warranty, support hours, order changes. Use this before answering any policy question.",
  parameters: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description: "What to look up, e.g. 'return window for delivered order'",
      },
    },
    required: ["query"],
  },
  async execute(args) {
    const queryTokens = tokenize(String(args.query ?? ""));
    const ranked = DOCS.map((doc) => ({ doc, s: score(queryTokens, doc) }))
      .filter((r) => r.s > 0)
      .sort((a, b) => b.s - a.s)
      .slice(0, 2);
    if (ranked.length === 0) {
      return { results: [], note: "No matching articles found." };
    }
    return { results: ranked.map(({ doc }) => ({ title: doc.title, content: doc.text })) };
  },
};
