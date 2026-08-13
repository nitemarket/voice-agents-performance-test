import { config } from "../../config";
import { compatTts } from "../openaiCompat";

export const openaiTts = compatTts(() => ({ apiKey: config.openaiKey }));
