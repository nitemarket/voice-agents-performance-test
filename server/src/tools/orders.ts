import type { ToolDef } from "./types";

// Mock order database standing in for a real orders API.
const ORDERS: Record<string, Record<string, unknown>> = {
  "1001": {
    order_id: "1001",
    customer: "Jamie Lee",
    items: ["Trailblazer hiking boots (size 42)", "Merino trekking socks x2"],
    status: "shipped",
    carrier: "UPS",
    tracking_number: "1Z999AA10123456784",
    estimated_delivery: "2026-08-19",
  },
  "1002": {
    order_id: "1002",
    customer: "Alex Chen",
    items: ["Alpine 2-person tent"],
    status: "processing",
    note: "Expected to ship within 2 business days.",
  },
  "1003": {
    order_id: "1003",
    customer: "Sam Patel",
    items: ["Thermal base layer", "Insulated water bottle"],
    status: "delivered",
    delivered_on: "2026-08-10",
    return_eligible_until: "2026-09-09",
  },
};

export const getOrderStatus: ToolDef = {
  name: "get_order_status",
  description:
    "Look up a customer's order by order number. Returns status, items, tracking and delivery information. Demo order numbers: 1001, 1002, 1003.",
  parameters: {
    type: "object",
    properties: {
      order_id: {
        type: "string",
        description: "The order number, e.g. '1001'",
      },
    },
    required: ["order_id"],
  },
  async execute(args) {
    // Simulate a real API round-trip so tool latency behavior is observable.
    await new Promise((r) => setTimeout(r, 400));
    const id = String(args.order_id ?? "").replace(/\D/g, "");
    const order = ORDERS[id];
    return order ?? { error: `No order found with number ${args.order_id}` };
  },
};
