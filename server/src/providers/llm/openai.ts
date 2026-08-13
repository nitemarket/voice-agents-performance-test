import { config } from "../../config";
import { compatLlm } from "../openaiCompat";

export const openaiLlm = compatLlm(() => ({ apiKey: config.openaiKey }));
