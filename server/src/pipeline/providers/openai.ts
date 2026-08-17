import { config } from "../../config";
import { compatLlm, compatStt, compatTts } from "../openaiCompat";

export const openaiStt = compatStt(() => ({ apiKey: config.openaiKey }));
export const openaiLlm = compatLlm(() => ({ apiKey: config.openaiKey }));
export const openaiTts = compatTts(() => ({ apiKey: config.openaiKey }));
