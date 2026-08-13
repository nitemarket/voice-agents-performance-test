import { Hono } from "hono";
import { catalog } from "../providers/registry";

export const providersRoute = new Hono().get("/providers", (c) => c.json(catalog()));
