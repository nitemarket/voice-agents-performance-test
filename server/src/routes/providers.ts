import { Hono } from "hono";
import { catalog } from "../pipeline/registry";

export const providersRoute = new Hono().get("/providers", (c) => c.json(catalog()));
