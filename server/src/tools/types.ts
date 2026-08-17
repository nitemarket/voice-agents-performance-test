export interface ToolDef {
  name: string;
  description: string;
  /** JSON Schema for the arguments (lowercase "type" values; adapters convert if needed). */
  parameters: Record<string, unknown>;
  execute(args: Record<string, unknown>): Promise<unknown>;
}
